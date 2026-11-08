// Despesas compartilhadas. Regra de ouro: cada usuário só grava no PRÓPRIO ledger, dentro da
// própria sessão (RLS por app.user_id). Tabelas do grupo são visíveis só a membros (fi_is_member).
//
// Modelo contábil (sem dupla contagem):
//  - Quem pagou: despesa = só a própria parte; o restante vai por transferência para a conta
//    "Valores a receber" (não é gasto). Saldo bancário sai o total, como no extrato.
//  - Participante: a parte vira compromisso "a pagar para Fulano"; vira despesa ao ser quitado.
//  - Reembolso recebido: transferência "Valores a receber" → conta (não é receita).
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, hash } from './auth';
import type { DB } from './db';
import { audit, insertMovement } from './finance-service';
import { cents, decimal, localToday, validDate } from '../lib/money';
import { cleanCategory, UNCATEGORIZED } from '../lib/categorize';
import { computeSplit, memberBalances, simplifyDebts } from '../lib/split';
import { financialDescription } from '../lib/intake';

const id = z.string().uuid();
const money = z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).refine((v) => cents(v) > 0n, 'O valor deve ser positivo.');
const date = z.string().refine(validDate, 'Data inválida.');
type Member = { id: string; group_id: string; user_id: string | null; display_name: string; role: string; auto_post: boolean; auto_account_id: string | null; skip_ledger: boolean; removed_at: string | null; created_at?: string };
type Expense = { id: string; group_id: string; created_by: string; payer_member_id: string; description: string; total: string; date: string; category: string; split_mode: string; version: number; deleted_at: string | null };
type Posting = { id: string; expense_id: string | null; settlement_id: string | null; role: string; version: number; transaction_id: string | null; transfer_id: string | null; obligation_id: string | null; notice: string | null };

/** Executa em savepoint: um erro desfaz só este passo, sem invalidar a transação inteira. */
async function safely<T>(db: DB, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  await db.query('SAVEPOINT fi_step');
  try { const value = await fn(); await db.query('RELEASE SAVEPOINT fi_step'); return { ok: true, value }; }
  catch (e) { await db.query('ROLLBACK TO SAVEPOINT fi_step'); return { ok: false, error: e instanceof Error ? e.message : 'erro' }; }
}
async function myMember(db: DB, user: string, group: string) {
  const m = (await db.query<Member>('SELECT * FROM share_members WHERE group_id=$1 AND user_id=$2 AND removed_at IS NULL', [group, user])).rows[0];
  if (!m) throw new AppError('Você não participa deste grupo.', 403);
  return m;
}
/** Plano da conta: "split_only" só usa o módulo de divisão, sem ledger próprio. */
export async function userPlan(db: DB, user: string) {
  return (await db.query<{ plan: string }>('SELECT plan FROM users WHERE id=$1', [user])).rows[0]?.plan || 'full';
}
/** Lança no financeiro do usuário? Só conta completa e grupo sem "não lançar". */
async function usesLedger(db: DB, user: string, me: Member) {
  return !me.skip_ledger && (await userPlan(db, user)) === 'full';
}
async function activeGroup(db: DB, group: string) {
  const g = (await db.query<{ status: string; created_by: string }>('SELECT status,created_by FROM share_groups WHERE id=$1', [group])).rows[0];
  if (!g) throw new AppError('Grupo não encontrado.', 404);
  if (g.status !== 'active') throw new AppError('Grupo encerrado: não aceita novos lançamentos.', 409);
  return g;
}
async function ownerOf(db: DB, user: string, group: string) {
  const me = await myMember(db, user, group);
  if (me.role !== 'owner') throw new AppError('Só quem criou o grupo pode fazer isso.', 403);
  return me;
}
async function connected(db: DB, a: string, b: string) {
  const r = await db.query("SELECT 1 FROM connections WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))", [a, b]);
  return r.rows.length > 0;
}
/** Conta "Valores a receber" do usuário (criada na primeira vez). */
async function receivableAccount(db: DB, user: string) {
  const r = await db.query<{ id: string }>("SELECT id FROM accounts WHERE user_id=$1 AND type='receivable' ORDER BY created_at LIMIT 1", [user]);
  if (r.rows[0]) return r.rows[0].id;
  const key = randomUUID();
  await db.query("INSERT INTO accounts(id,user_id,name,institution,type,opening_balance,opening_date) VALUES($1,$2,'Valores a receber','Despesas compartilhadas','receivable',0,'2000-01-01')", [key, user]);
  return key;
}
async function sharesOf(db: DB, expense: string) {
  return Object.fromEntries((await db.query<{ member_id: string; amount: string }>('SELECT member_id,amount::text FROM shared_shares WHERE expense_id=$1', [expense])).rows.map((s) => [s.member_id, s.amount]));
}
async function memberName(db: DB, memberId: string) {
  return (await db.query<{ display_name: string }>('SELECT display_name FROM share_members WHERE id=$1', [memberId])).rows[0]?.display_name || 'outro membro';
}

/** Pagador: despesa só da própria parte + transferência do restante para "Valores a receber". */
async function payerMovements(db: DB, user: string, e: Expense, mine: bigint, account: string) {
  const others = cents(e.total) - mine;
  let transaction_id: string | null = null, transfer_id: string | null = null;
  if (mine > 0n) transaction_id = await insertMovement(db, user, { account_id: account, kind: 'expense', amount: decimal(mine), date: e.date, competence: e.date, description: e.description, category: e.category }, { source: 'shared' });
  if (others > 0n) {
    const rec = await receivableAccount(db, user);
    transfer_id = await insertMovement(db, user, { account_id: account, destination_account_id: rec, kind: 'transfer', amount: decimal(others), date: e.date, competence: e.date, description: `A receber: ${e.description}`, category: 'Transferência interna' }, { source: 'shared' });
  }
  return { transaction_id, transfer_id };
}

/** Lança a parte do usuário atual no ledger dele. Idempotente por (usuário, despesa, papel). */
async function materialize(db: DB, user: string, e: Expense, me: Member, accountId?: string) {
  const shares = await sharesOf(db, e.id);
  const mine = cents(shares[me.id] || '0');
  const payer = e.payer_member_id === me.id;
  const role = payer ? 'payer' : 'participant';
  if ((await db.query('SELECT 1 FROM shared_postings WHERE user_id=$1 AND expense_id=$2 AND role=$3', [user, e.id, role])).rows.length) return false;
  if (!(await usesLedger(db, user, me))) return false;
  let posting = { transaction_id: null as string | null, transfer_id: null as string | null, obligation_id: null as string | null };
  if (payer) {
    const account = accountId || me.auto_account_id;
    if (!account) throw new AppError('Escolha a conta de onde saiu o pagamento.');
    posting = { ...posting, ...(await payerMovements(db, user, e, mine, account)) };
  } else {
    if (mine <= 0n) return false;
    posting.obligation_id = randomUUID();
    await db.query("INSERT INTO obligations(id,user_id,description,amount,due_date,kind,category,stage) VALUES($1,$2,$3,$4,$5,'expense',$6,'charged')",
      [posting.obligation_id, user, financialDescription(`${e.description} — pagar para ${await memberName(db, e.payer_member_id)}`), decimal(mine), e.date, e.category]);
  }
  await db.query('INSERT INTO shared_postings(id,user_id,expense_id,role,version,transaction_id,transfer_id,obligation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), user, e.id, role, e.version, posting.transaction_id, posting.transfer_id, posting.obligation_id]);
  await audit(db, user, 'shared.posted', e.id, { role, amount: decimal(mine) });
  return true;
}

/** Ajusta o ledger do usuário quando a despesa foi editada ou excluída por quem a criou. */
async function reconcile(db: DB, user: string) {
  const stale = (await db.query<Posting & { deleted_at: string | null; ev: number }>(
    `SELECT p.*, e.deleted_at, e.version AS ev FROM shared_postings p JOIN shared_expenses e ON e.id=p.expense_id
     WHERE p.user_id=$1 AND p.role IN ('payer','participant') AND (e.deleted_at IS NOT NULL OR e.version<>p.version)`, [user])).rows;
  for (const p of stale) {
    const r = await safely(db, () => reconcileOne(db, user, p));
    if (!r.ok) await db.query('UPDATE shared_postings SET notice=$1 WHERE id=$2', [`Não foi possível ajustar automaticamente: ${r.error}`, p.id]);
  }
}
async function reconcileOne(db: DB, user: string, p: Posting) {
  {
    const e = (await db.query<Expense>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at FROM shared_expenses WHERE id=$1', [p.expense_id])).rows[0];
    const me = (await db.query<Member>('SELECT * FROM share_members WHERE group_id=$1 AND user_id=$2', [e.group_id, user])).rows[0];
    if (p.role === 'participant' && p.obligation_id) {
      const o = (await db.query<{ status: string }>('SELECT status FROM obligations WHERE id=$1 AND user_id=$2', [p.obligation_id, user])).rows[0];
      const share = e.deleted_at ? 0n : cents((await sharesOf(db, e.id))[me.id] || '0');
      if (o?.status === 'open') {
        if (share === 0n) await db.query("UPDATE obligations SET status='cancelled' WHERE id=$1 AND user_id=$2", [p.obligation_id, user]);
        else await db.query('UPDATE obligations SET amount=$1,due_date=$2,category=$3 WHERE id=$4 AND user_id=$5', [decimal(share), e.date, e.category, p.obligation_id, user]);
        await db.query('UPDATE shared_postings SET version=$1 WHERE id=$2', [e.version, p.id]);
      } else {
        const text = e.deleted_at ? `"${e.description}" foi excluída depois que você pagou a sua parte. Combine o reembolso com quem pagou.`
          : `"${e.description}" foi alterada depois que você pagou. Sua parte agora é R$ ${decimal(share).replace('.', ',')}; combine a diferença.`;
        await db.query('UPDATE shared_postings SET version=$1, notice=$2 WHERE id=$3', [e.version, text, p.id]);
      }
    } else if (p.role === 'payer') {
      const account = p.transaction_id || p.transfer_id
        ? (await db.query<{ account_id: string }>('SELECT account_id FROM transactions WHERE id=$1 AND user_id=$2', [p.transaction_id || p.transfer_id, user])).rows[0]?.account_id
        : undefined;
      // Estorna o lançamento anterior e, se a despesa continua (e ainda sou o pagador), relança.
      for (const t of [p.transaction_id, p.transfer_id]) if (t) await db.query("UPDATE transactions SET status='reversed' WHERE id=$1 AND user_id=$2", [t, user]);
      let ids: { transaction_id: string | null; transfer_id: string | null } = { transaction_id: null, transfer_id: null };
      if (!e.deleted_at && me && me.id === e.payer_member_id && account)
        ids = await payerMovements(db, user, e, cents((await sharesOf(db, e.id))[me.id] || '0'), account);
      await db.query('UPDATE shared_postings SET version=$1,transaction_id=$2,transfer_id=$3 WHERE id=$4', [e.version, ids.transaction_id, ids.transfer_id, p.id]);
      await audit(db, user, 'shared.adjusted', e.id, { deleted: !!e.deleted_at });
    } else {
      // Parte marcada como "não lançar": nada no ledger, só acompanha a versão.
      await db.query('UPDATE shared_postings SET version=$1 WHERE id=$2', [e.version, p.id]);
    }
  }
}

/** Sincroniza o ledger do usuário (ajustes e lançamento automático) e devolve o estado do módulo. */
export async function sharedState(db: DB, user: string) {
  const memberships = (await db.query<Member>('SELECT * FROM share_members WHERE user_id=$1 AND removed_at IS NULL', [user])).rows;
  if (memberships.length) {
    await reconcile(db, user);
    const full = (await userPlan(db, user)) === 'full';
    for (const me of memberships.filter((m) => full && m.auto_post && !m.skip_ledger)) {
      const pending = (await db.query<Expense>(
        `SELECT e.id,e.group_id,e.created_by,e.payer_member_id,e.description,e.total::text,e.date::text,e.category,e.split_mode,e.version,e.deleted_at FROM shared_expenses e
         WHERE e.group_id=$1 AND e.deleted_at IS NULL AND e.date<=$3 AND NOT EXISTS (SELECT 1 FROM shared_postings p WHERE p.user_id=$2 AND p.expense_id=e.id)`, [me.group_id, user, localToday()])).rows;
      for (const e of pending) if (e.payer_member_id !== me.id || me.auto_account_id) await safely(db, () => materialize(db, user, e, me));
    }
  }
  const connections = (await db.query<{ id: string; requester_id: string; addressee_id: string; status: string; blocked_by: string | null; name: string; email: string }>(
    `SELECT c.id,c.requester_id,c.addressee_id,c.status,c.blocked_by,u.name,u.email FROM connections c
     JOIN users u ON u.id = CASE WHEN c.requester_id=$1 THEN c.addressee_id ELSE c.requester_id END
     WHERE (c.requester_id=$1 OR c.addressee_id=$1) AND NOT (c.status='blocked' AND c.blocked_by<>$1) AND c.status<>'declined' ORDER BY u.name`, [user])).rows
    .map((c) => ({ id: c.id, user_id: c.requester_id === user ? c.addressee_id : c.requester_id, name: c.name, email: c.email, status: c.status, incoming: c.addressee_id === user && c.status === 'pending' }));
  const plan = await userPlan(db, user);
  const groups = [];
  for (const g of (await db.query<{ id: string; name: string; kind: string; status: string; created_by: string; starts_on: string | null; ends_on: string | null; closed_at: string | null; created_at: string }>(
    'SELECT g.id,g.name,g.kind,g.status,g.created_by,g.starts_on::text,g.ends_on::text,g.closed_at::text,g.created_at::text FROM share_groups g JOIN share_members m ON m.group_id=g.id AND m.user_id=$1 AND m.removed_at IS NULL ORDER BY g.status, g.created_at', [user])).rows) {
    const members = (await db.query<Member>('SELECT id,group_id,user_id,display_name,role,auto_post,auto_account_id,skip_ledger,removed_at::text,created_at::text FROM share_members WHERE group_id=$1 ORDER BY share_members.created_at', [g.id])).rows;
    const me = members.find((m) => m.user_id === user)!;
    const all = (await db.query<Expense & { created_at: string; updated_at: string }>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at::text,created_at::text,updated_at::text FROM shared_expenses WHERE group_id=$1 ORDER BY date DESC, created_at DESC', [g.id])).rows;
    const expenses = all.filter((e) => !e.deleted_at);
    const shares = (await db.query<{ expense_id: string; member_id: string; amount: string }>('SELECT expense_id,member_id,amount::text FROM shared_shares WHERE group_id=$1', [g.id])).rows;
    const settlements = (await db.query<{ id: string; from_member_id: string; to_member_id: string; amount: string; date: string; status: string; created_at: string; confirmed_at: string | null }>('SELECT id,from_member_id,to_member_id,amount::text,date::text,status,created_at::text,confirmed_at::text FROM shared_settlements WHERE group_id=$1 ORDER BY created_at DESC', [g.id])).rows;
    const invites = me.role === 'owner' ? (await db.query<{ id: string; expires_at: string; uses: number; max_uses: number }>('SELECT id,expires_at::text,uses,max_uses FROM share_invites WHERE group_id=$1 AND revoked_at IS NULL AND expires_at>now() AND uses<max_uses ORDER BY created_at DESC', [g.id])).rows : [];
    const shareMap = (e: string) => Object.fromEntries(shares.filter((s) => s.expense_id === e).map((s) => [s.member_id, s.amount]));
    const balances = memberBalances(members.map((m) => m.id), expenses.map((e) => ({ payer: e.payer_member_id, total: e.total, shares: shareMap(e.id) })),
      settlements.map((s) => ({ from: s.from_member_id, to: s.to_member_id, amount: s.amount, status: s.status })));
    const nameOf = (id: string) => { const m = members.find((x) => x.id === id); return m ? (m.user_id === user ? 'Você' : m.display_name) : 'alguém'; };
    const byUser = (u: string) => { const m = members.find((x) => x.user_id === u); return m ? nameOf(m.id) : 'alguém'; };
    // Feed derivado dos próprios registros (sem tabela extra): quem fez o quê e quando.
    const feed = [
      ...members.filter((m) => m.created_at).map((m) => ({ at: m.created_at!, text: `${nameOf(m.id)} entrou no grupo${m.user_id ? '' : ' (sem conta)'}` })),
      ...members.filter((m) => m.removed_at).map((m) => ({ at: m.removed_at!, text: `${nameOf(m.id)} saiu do grupo` })),
      ...all.map((e) => ({ at: e.created_at, text: `${byUser(e.created_by)} lançou "${e.description}" (R$ ${e.total.replace('.', ',')})` })),
      ...all.filter((e) => e.version > 1 && !e.deleted_at).map((e) => ({ at: e.updated_at, text: `${byUser(e.created_by)} alterou "${e.description}"` })),
      ...all.filter((e) => e.deleted_at).map((e) => ({ at: e.deleted_at!, text: `${byUser(e.created_by)} excluiu "${e.description}"` })),
      ...settlements.map((s) => ({ at: s.created_at, text: `${nameOf(s.from_member_id)} pagou R$ ${s.amount.replace('.', ',')} a ${nameOf(s.to_member_id).replace(/^Você$/, 'você')}` })),
      ...settlements.filter((s) => s.confirmed_at).map((s) => ({ at: s.confirmed_at!, text: `${nameOf(s.to_member_id)} confirmou o recebimento de R$ ${s.amount.replace('.', ',')}` })),
      ...(g.closed_at ? [{ at: g.closed_at, text: 'Grupo encerrado' }] : []),
    ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
    groups.push({
      id: g.id, name: g.name, kind: g.kind, status: g.status, starts_on: g.starts_on, ends_on: g.ends_on, owner: me.role === 'owner', my_member_id: me.id,
      auto_post: me.auto_post, auto_account_id: me.auto_account_id, skip_ledger: me.skip_ledger || plan !== 'full',
      members: members.map((m) => ({ id: m.id, user_id: m.user_id, name: m.display_name, role: m.role, removed: !!m.removed_at, me: m.user_id === user, guest: !m.user_id })),
      expenses: expenses.map((e) => ({ id: e.id, description: e.description, total: e.total, date: e.date, category: e.category, payer_member_id: e.payer_member_id, split_mode: e.split_mode, mine: e.created_by === user, shares: shareMap(e.id) })),
      settlements: settlements.map(({ created_at: _c, confirmed_at: _k, ...s }) => s), balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, decimal(v)])),
      suggestions: simplifyDebts(balances), invites, feed,
    });
  }
  const posted = new Set((await db.query<{ expense_id: string; role: string }>('SELECT expense_id,role FROM shared_postings WHERE user_id=$1 AND expense_id IS NOT NULL', [user])).rows.map((r) => `${r.expense_id}|${r.role}`));
  const pendingRole = (g: { my_member_id: string }, e: { id: string; payer_member_id: string; shares: Record<string, string> }) =>
    e.payer_member_id === g.my_member_id ? !posted.has(`${e.id}|payer`) : cents(e.shares[g.my_member_id] || '0') > 0n && !posted.has(`${e.id}|participant`);
  const inbox = groups.filter((g) => !g.skip_ledger).flatMap((g) => g.expenses.filter((e) => pendingRole(g, e))
    .map((e) => ({ expense_id: e.id, group_id: g.id, group_name: g.name, description: e.description, total: e.total, date: e.date, my_share: e.shares[g.my_member_id] || '0.00', i_am_payer: e.payer_member_id === g.my_member_id, payer_name: g.members.find((m) => m.id === e.payer_member_id)?.name || '' })));
  const notices = (await db.query<{ expense_id: string; notice: string }>('SELECT expense_id,notice FROM shared_postings WHERE user_id=$1 AND notice IS NOT NULL ORDER BY created_at DESC LIMIT 20', [user])).rows;
  return { plan, connections, groups, inbox, notices };
}

export const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'Convite inválido.');
/** Prévia de um link de convite (sem sessão): nome do grupo, quem convidou e membros sem conta. */
export async function invitePreview(db: DB, token: string) {
  const r = (await db.query<{ group_name: string; kind: string; inviter: string; guests: { id: string; name: string }[] }>('SELECT * FROM fi_invite_preview($1)', [hash(token)])).rows[0];
  if (!r) throw new AppError('Convite inválido, expirado ou esgotado.', 404);
  return r;
}
/** Entra no grupo pelo link como o usuário da transação (app.user_id). */
export async function joinByInvite(db: DB, token: string, claim?: string) {
  const r = await db.query<{ g: string | null }>('SELECT fi_join_by_invite($1,$2) AS g', [hash(token), claim || null]);
  if (!r.rows[0]?.g) throw new AppError('Convite inválido, expirado ou esgotado.', 404);
  return r.rows[0].g;
}

const expenseSchema = z.object({
  group_id: id, description: z.string().trim().min(1).max(160), total: money, date, category: z.string().trim().max(80).default(''),
  payer_member_id: id, mode: z.enum(['equal', 'selected', 'exact', 'percent']),
  selected: z.array(id).max(100).default([]), exact: z.record(z.string(), z.string().max(20)).default({}), percent: z.record(z.string(), z.string().max(8)).default({}),
  account_id: id.optional(), source_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

async function writeExpense(db: DB, user: string, v: z.infer<typeof expenseSchema>, existing?: Expense) {
  await activeGroup(db, v.group_id);
  const me = await myMember(db, user, v.group_id);
  if (!existing) {
    const today = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM shared_expenses WHERE created_by=$1 AND created_at>now()-interval '1 day'", [user]);
    if (today.rows[0].n >= 300) throw new AppError('Limite de 300 despesas por dia atingido.', 429);
  }
  const members = (await db.query<{ id: string }>('SELECT id FROM share_members WHERE group_id=$1 AND removed_at IS NULL ORDER BY created_at', [v.group_id])).rows.map((m) => m.id);
  if (!members.includes(v.payer_member_id)) throw new AppError('Quem pagou precisa ser membro do grupo.');
  if (v.date > localToday()) throw new AppError('A data não pode ser futura.');
  const split = computeSplit({ total: v.total, mode: v.mode, members, selected: v.selected, exact: v.exact, percent: v.percent });
  if (!split.ok) throw new AppError(split.error);
  const category = cleanCategory(v.category) || UNCATEGORIZED;
  const key = existing?.id || randomUUID();
  if (existing) {
    await db.query('UPDATE shared_expenses SET description=$1,total=$2,date=$3,category=$4,payer_member_id=$5,split_mode=$6,version=version+1,updated_at=now() WHERE id=$7', [financialDescription(v.description), v.total, v.date, category, v.payer_member_id, v.mode, key]);
    await db.query('DELETE FROM shared_shares WHERE expense_id=$1', [key]);
  } else {
    await db.query('INSERT INTO shared_expenses(id,group_id,created_by,payer_member_id,description,total,date,category,split_mode,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [key, v.group_id, user, v.payer_member_id, financialDescription(v.description), v.total, v.date, category, v.mode, v.source_hash || null]);
  }
  for (const [member, amount] of Object.entries(split.shares))
    await db.query('INSERT INTO shared_shares(id,expense_id,group_id,member_id,amount) VALUES($1,$2,$3,$4,$5)', [randomUUID(), key, v.group_id, member, amount]);
  await audit(db, user, existing ? 'shared.updated' : 'shared.created', key, { total: v.total, mode: v.mode });
  const e = (await db.query<Expense>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at FROM shared_expenses WHERE id=$1', [key])).rows[0];
  if (existing) await reconcile(db, user);
  else if (v.payer_member_id !== me.id || v.account_id) await materialize(db, user, e, me, v.account_id);
  return { id: key };
}

export async function sharedAction(db: DB, user: string, action: string, payload: unknown) {
  if (action === 'connect.request') {
    const v = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(payload);
    const neutral = { id: user, message: 'Se existir uma conta com esse e-mail, o pedido foi enviado.' };
    const recent = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM connections WHERE requester_id=$1 AND created_at>now()-interval '1 day'", [user]);
    if (recent.rows[0].n >= 20) throw new AppError('Limite de pedidos por dia atingido.', 429);
    const target = (await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=$1', [v.email])).rows[0];
    if (!target || target.id === user) return neutral;
    const pair = (await db.query<{ id: string; status: string }>('SELECT id,status FROM connections WHERE LEAST(requester_id,addressee_id)=LEAST($1::uuid,$2::uuid) AND GREATEST(requester_id,addressee_id)=GREATEST($1::uuid,$2::uuid)', [user, target.id])).rows[0];
    if (!pair) await db.query("INSERT INTO connections(id,requester_id,addressee_id) VALUES($1,$2,$3)", [randomUUID(), user, target.id]);
    else if (pair.status === 'declined') await db.query("UPDATE connections SET requester_id=$1,addressee_id=$2,status='pending',responded_at=NULL,blocked_by=NULL,created_at=now() WHERE id=$3", [user, target.id, pair.id]);
    await audit(db, user, action, user);
    return neutral;
  }
  if (action === 'connect.respond') {
    const v = z.object({ id, accept: z.boolean() }).parse(payload);
    const r = await db.query("UPDATE connections SET status=$1,responded_at=now() WHERE id=$2 AND addressee_id=$3 AND status='pending' RETURNING id", [v.accept ? 'accepted' : 'declined', v.id, user]);
    if (!r.rows.length) throw new AppError('Pedido não encontrado.', 404);
    await audit(db, user, action, v.id, { accept: v.accept });
    return { id: v.id };
  }
  if (action === 'connect.remove' || action === 'connect.block') {
    const v = z.object({ id }).parse(payload);
    const r = action === 'connect.block'
      ? await db.query("UPDATE connections SET status='blocked',blocked_by=$2,responded_at=now() WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2) RETURNING id", [v.id, user])
      : await db.query("UPDATE connections SET status='declined',responded_at=now() WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2) AND NOT (status='blocked' AND blocked_by<>$2) RETURNING id", [v.id, user]);
    if (!r.rows.length) throw new AppError('Conexão não encontrada.', 404);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  if (action === 'group.create') {
    const v = z.object({
      name: z.string().trim().min(1).max(80), kind: z.enum(['home', 'trip', 'event', 'other']).default('home'),
      member_user_ids: z.array(id).max(30).default([]), guest_names: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
      starts_on: z.union([date, z.literal('')]).default(''), ends_on: z.union([date, z.literal('')]).default(''),
    }).parse(payload);
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) throw new AppError('O fim do período precisa ser depois do início.');
    for (const other of v.member_user_ids) if (!(await connected(db, user, other))) throw new AppError('Só é possível incluir pessoas conectadas a você.', 403);
    const owned = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM share_groups WHERE created_by=$1 AND status<>'archived'", [user]);
    const maxGroups = (await userPlan(db, user)) === 'full' ? 50 : 10;
    if (owned.rows[0].n >= maxGroups) throw new AppError(`Limite de ${maxGroups} grupos ativos atingido. Arquive grupos encerrados.`, 429);
    const key = randomUUID();
    await db.query('INSERT INTO share_groups(id,name,kind,created_by,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6)', [key, v.name, v.kind, user, v.starts_on || null, v.ends_on || null]);
    const names = new Map((await db.query<{ id: string; name: string }>('SELECT id,name FROM users WHERE id = ANY($1::uuid[])', [[user, ...v.member_user_ids]])).rows.map((u) => [u.id, u.name]));
    await db.query("INSERT INTO share_members(id,group_id,user_id,display_name,role) VALUES($1,$2,$3,$4,'owner')", [randomUUID(), key, user, names.get(user) || 'Eu']);
    for (const other of [...new Set(v.member_user_ids)].filter((x) => x !== user))
      await db.query("INSERT INTO share_members(id,group_id,user_id,display_name) VALUES($1,$2,$3,$4)", [randomUUID(), key, other, names.get(other) || 'Membro']);
    for (const guest of v.guest_names) await db.query('INSERT INTO share_members(id,group_id,display_name) VALUES($1,$2,$3)', [randomUUID(), key, guest]);
    await audit(db, user, action, key, { members: v.member_user_ids.length + 1, guests: v.guest_names.length });
    return { id: key };
  }
  if (action === 'group.settings') {
    const v = z.object({ group_id: id, auto_post: z.boolean(), auto_account_id: z.union([id, z.literal('')]).default(''), skip_ledger: z.boolean().optional() }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    if (v.auto_account_id && !(await db.query("SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2 AND type<>'receivable'", [v.auto_account_id, user])).rows.length) throw new AppError('Conta não encontrada.', 404);
    await db.query('UPDATE share_members SET auto_post=$1,auto_account_id=$2,skip_ledger=$3 WHERE id=$4', [v.auto_post, v.auto_account_id || null, v.skip_ledger ?? me.skip_ledger, me.id]);
    return { id: v.group_id };
  }
  if (action === 'group.leave') {
    const v = z.object({ group_id: id }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    await db.query('UPDATE share_members SET removed_at=now() WHERE id=$1', [me.id]);
    await audit(db, user, action, v.group_id);
    return { id: v.group_id };
  }
  if (action === 'shared.create') return writeExpense(db, user, expenseSchema.parse(payload));
  if (action === 'shared.update' || action === 'shared.delete') {
    const v = z.object({ id }).passthrough().parse(payload);
    const e = (await db.query<Expense>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at FROM shared_expenses WHERE id=$1 AND deleted_at IS NULL', [v.id])).rows[0];
    if (!e) throw new AppError('Despesa não encontrada.', 404);
    if (e.created_by !== user) throw new AppError('Só quem lançou pode alterar esta despesa.', 403);
    await activeGroup(db, e.group_id);
    if (action === 'shared.update') return writeExpense(db, user, expenseSchema.parse({ ...(payload as object), group_id: e.group_id }), e);
    await db.query('UPDATE shared_expenses SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1', [e.id]);
    await audit(db, user, action, e.id);
    await reconcile(db, user);
    return { id: e.id };
  }
  if (action === 'shared.post') {
    const v = z.object({ expense_id: id, account_id: id.optional() }).parse(payload);
    const e = (await db.query<Expense>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at FROM shared_expenses WHERE id=$1 AND deleted_at IS NULL', [v.expense_id])).rows[0];
    if (!e) throw new AppError('Despesa não encontrada.', 404);
    await materialize(db, user, e, await myMember(db, user, e.group_id), v.account_id);
    return { id: e.id };
  }
  if (action === 'settle.pay') {
    // Quem deve marca o pagamento. Conta completa: quita no PRÓPRIO ledger as partes em aberto
    // devidas a esse membro. Sem lançamentos (só divisão ou partes não lançadas): informa o valor.
    const v = z.object({ group_id: id, to_member_id: id, account_id: id.optional(), amount: money.optional(), date }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    if (v.to_member_id === me.id) throw new AppError('Escolha outra pessoa.');
    if (v.date > localToday()) throw new AppError('A data não pode ser futura.');
    const to = (await db.query<Member>('SELECT * FROM share_members WHERE id=$1 AND group_id=$2 AND removed_at IS NULL', [v.to_member_id, v.group_id])).rows[0];
    if (!to) throw new AppError('Pessoa não encontrada no grupo.', 404);
    const open = (await usesLedger(db, user, me)) ? (await db.query<{ obligation_id: string; amount: string; description: string; category: string; due: string }>(
      `SELECT p.obligation_id, o.amount::text, o.description, o.category, o.due_date::text AS due FROM shared_postings p
       JOIN shared_expenses e ON e.id=p.expense_id JOIN obligations o ON o.id=p.obligation_id AND o.user_id=$1
       WHERE p.user_id=$1 AND p.role='participant' AND o.status='open' AND e.group_id=$2 AND e.payer_member_id=$3`, [user, v.group_id, v.to_member_id])).rows : [];
    let total = 0n;
    if (open.length) {
      if (!v.account_id) throw new AppError('Escolha a conta de onde saiu o pagamento.');
      for (const o of open) {
        const tx = await insertMovement(db, user, { account_id: v.account_id, kind: 'expense', amount: o.amount, date: v.date, competence: o.due, description: o.description, category: o.category }, { source: 'shared' });
        await db.query("UPDATE obligations SET status='paid',settled_transaction_id=$1 WHERE id=$2 AND user_id=$3", [tx, o.obligation_id, user]);
        total += cents(o.amount);
      }
    } else if (v.amount) total = cents(v.amount);
    else throw new AppError('Informe o valor pago (ou lance antes as partes pendentes em "Para lançar").');
    // Quem recebe sem conta no app não tem como confirmar: o acerto já nasce confirmado.
    const status = to.user_id ? 'pending' : 'confirmed';
    const key = randomUUID();
    await db.query('INSERT INTO shared_settlements(id,group_id,from_member_id,to_member_id,amount,date,created_by,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [key, v.group_id, me.id, v.to_member_id, decimal(total), v.date, user, status, status === 'confirmed' ? new Date().toISOString() : null]);
    await db.query("INSERT INTO shared_postings(id,user_id,settlement_id,role) VALUES($1,$2,$3,'settle_paid')", [randomUUID(), user, key]);
    await audit(db, user, action, key, { amount: decimal(total), parts: open.length });
    return { id: key, amount: decimal(total) };
  }
  if (action === 'settle.receive') {
    // Recebi de alguém sem conta no app: registro direto, já confirmado.
    const v = z.object({ group_id: id, from_member_id: id, amount: money, date, account_id: id.optional() }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    const from = (await db.query<Member>('SELECT * FROM share_members WHERE id=$1 AND group_id=$2', [v.from_member_id, v.group_id])).rows[0];
    if (!from || from.id === me.id) throw new AppError('Pessoa não encontrada no grupo.', 404);
    if (from.user_id) throw new AppError('Essa pessoa tem conta: ela registra o pagamento e você confirma.');
    if (v.date > localToday()) throw new AppError('A data não pode ser futura.');
    const ledger = await usesLedger(db, user, me);
    if (ledger && !v.account_id) throw new AppError('Escolha a conta onde o dinheiro entrou.');
    const key = randomUUID();
    await db.query("INSERT INTO shared_settlements(id,group_id,from_member_id,to_member_id,amount,date,created_by,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now())",
      [key, v.group_id, from.id, me.id, v.amount, v.date, user]);
    const transfer = ledger ? await insertMovement(db, user, { account_id: await receivableAccount(db, user), destination_account_id: v.account_id!, kind: 'transfer', amount: v.amount, date: v.date, competence: v.date, description: 'Reembolso de despesa compartilhada', category: 'Transferência interna' }, { source: 'shared' }) : null;
    await db.query("INSERT INTO shared_postings(id,user_id,settlement_id,role,transfer_id) VALUES($1,$2,$3,'settle_received',$4)", [randomUUID(), user, key, transfer]);
    await audit(db, user, action, key, { amount: v.amount });
    return { id: key };
  }
  if (action === 'settle.confirm' || action === 'settle.reject') {
    // Quem recebeu confirma: baixa o "a receber" no próprio ledger (transferência, não receita).
    const v = z.object({ id, account_id: id.optional() }).parse(payload);
    const s = (await db.query<{ id: string; group_id: string; to_member_id: string; amount: string; date: string; status: string }>('SELECT id,group_id,to_member_id,amount::text,date::text,status FROM shared_settlements WHERE id=$1', [v.id])).rows[0];
    if (!s || s.status !== 'pending') throw new AppError('Acerto não está pendente.', 409);
    const me = await myMember(db, user, s.group_id);
    if (s.to_member_id !== me.id) throw new AppError('Só quem recebeu pode confirmar.', 403);
    if (action === 'settle.reject') {
      await db.query("UPDATE shared_settlements SET status='rejected' WHERE id=$1", [s.id]);
      await audit(db, user, action, s.id);
      return { id: s.id };
    }
    const ledger = await usesLedger(db, user, me);
    if (ledger && !v.account_id) throw new AppError('Escolha a conta onde o dinheiro entrou.');
    const transfer = ledger ? await insertMovement(db, user, { account_id: await receivableAccount(db, user), destination_account_id: v.account_id!, kind: 'transfer', amount: s.amount, date: s.date, competence: s.date, description: 'Reembolso de despesa compartilhada', category: 'Transferência interna' }, { source: 'shared' }) : null;
    await db.query("UPDATE shared_settlements SET status='confirmed',confirmed_at=now() WHERE id=$1", [s.id]);
    await db.query("INSERT INTO shared_postings(id,user_id,settlement_id,role,transfer_id) VALUES($1,$2,$3,'settle_received',$4)", [randomUUID(), user, s.id, transfer]);
    await audit(db, user, action, s.id, { amount: s.amount });
    return { id: s.id };
  }
  if (action === 'shared.skip') {
    // "Não lançar": marca a parte como tratada sem mexer no financeiro.
    const v = z.object({ expense_id: id }).parse(payload);
    const e = (await db.query<Expense>('SELECT id,group_id,payer_member_id,version FROM shared_expenses WHERE id=$1 AND deleted_at IS NULL', [v.expense_id])).rows[0];
    if (!e) throw new AppError('Despesa não encontrada.', 404);
    const me = await myMember(db, user, e.group_id);
    const role = e.payer_member_id === me.id ? 'payer' : 'participant';
    await db.query('INSERT INTO shared_postings(id,user_id,expense_id,role,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [randomUUID(), user, e.id, role, e.version]);
    return { id: e.id };
  }
  if (action === 'group.update') {
    const v = z.object({ group_id: id, name: z.string().trim().min(1).max(80), starts_on: z.union([date, z.literal('')]).default(''), ends_on: z.union([date, z.literal('')]).default('') }).parse(payload);
    await ownerOf(db, user, v.group_id);
    if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) throw new AppError('O fim do período precisa ser depois do início.');
    await db.query('UPDATE share_groups SET name=$1,starts_on=$2,ends_on=$3 WHERE id=$4', [v.name, v.starts_on || null, v.ends_on || null, v.group_id]);
    await audit(db, user, action, v.group_id);
    return { id: v.group_id };
  }
  if (action === 'group.close' || action === 'group.reopen' || action === 'group.archive') {
    const v = z.object({ group_id: id }).parse(payload);
    await ownerOf(db, user, v.group_id);
    const [from, to] = action === 'group.close' ? ['active', 'closed'] : action === 'group.reopen' ? ['closed', 'active'] : ['closed', 'archived'];
    const r = await db.query(`UPDATE share_groups SET status=$1, closed_at=${to === 'active' ? 'NULL' : 'coalesce(closed_at, now())'} WHERE id=$2 AND status=$3 RETURNING id`, [to, v.group_id, from]);
    if (!r.rows.length) throw new AppError(action === 'group.archive' ? 'Encerre o grupo antes de arquivar.' : 'O grupo não está nesse estado.', 409);
    if (to !== 'active') await db.query('UPDATE share_invites SET revoked_at=now() WHERE group_id=$1 AND revoked_at IS NULL', [v.group_id]);
    await audit(db, user, action, v.group_id);
    return { id: v.group_id };
  }
  if (action === 'group.add_guest') {
    const v = z.object({ group_id: id, name: z.string().trim().min(1).max(80) }).parse(payload);
    await activeGroup(db, v.group_id);
    await myMember(db, user, v.group_id);
    const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM share_members WHERE group_id=$1 AND removed_at IS NULL', [v.group_id]);
    if (n.rows[0].n >= 50) throw new AppError('O grupo já tem 50 pessoas.', 429);
    const key = randomUUID();
    await db.query('INSERT INTO share_members(id,group_id,display_name) VALUES($1,$2,$3)', [key, v.group_id, v.name]);
    await audit(db, user, action, v.group_id);
    return { id: key };
  }
  if (action === 'group.remove_guest') {
    const v = z.object({ group_id: id, member_id: id }).parse(payload);
    await ownerOf(db, user, v.group_id);
    const m = (await db.query<Member>('SELECT * FROM share_members WHERE id=$1 AND group_id=$2 AND user_id IS NULL AND removed_at IS NULL', [v.member_id, v.group_id])).rows[0];
    if (!m) throw new AppError('Pessoa sem conta não encontrada.', 404);
    const used = await db.query(`SELECT 1 FROM shared_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE s.member_id=$1 AND e.deleted_at IS NULL AND s.amount>0
      UNION ALL SELECT 1 FROM shared_expenses WHERE payer_member_id=$1 AND deleted_at IS NULL UNION ALL SELECT 1 FROM shared_settlements WHERE (from_member_id=$1 OR to_member_id=$1) AND status<>'rejected' LIMIT 1`, [m.id]);
    if (used.rows.length) throw new AppError('Essa pessoa já tem despesas ou acertos no grupo.', 409);
    await db.query('UPDATE share_members SET removed_at=now() WHERE id=$1', [m.id]);
    await audit(db, user, action, v.group_id);
    return { id: m.id };
  }
  if (action === 'invite.create') {
    const v = z.object({ group_id: id, days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7), max_uses: z.number().int().min(1).max(50).default(10) }).parse(payload);
    await activeGroup(db, v.group_id);
    await ownerOf(db, user, v.group_id);
    const recent = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM share_invites WHERE created_by=$1 AND created_at>now()-interval '1 day'", [user]);
    if (recent.rows[0].n >= 20) throw new AppError('Limite de 20 links por dia atingido.', 429);
    const live = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM share_invites WHERE group_id=$1 AND revoked_at IS NULL AND expires_at>now() AND uses<max_uses', [v.group_id]);
    if (live.rows[0].n >= 5) throw new AppError('Este grupo já tem 5 links ativos. Revogue um antes.', 429);
    const token = randomBytes(24).toString('base64url');
    const r = await db.query<{ expires_at: string }>(`INSERT INTO share_invites(id,group_id,token_hash,created_by,expires_at,max_uses) VALUES($1,$2,$3,$4,now()+make_interval(days => $5),$6) RETURNING expires_at::text`,
      [randomUUID(), v.group_id, hash(token), user, v.days, v.max_uses]);
    await audit(db, user, action, v.group_id, { days: v.days, max_uses: v.max_uses });
    return { id: v.group_id, token, expires_at: r.rows[0].expires_at };
  }
  if (action === 'invite.revoke') {
    const v = z.object({ id }).parse(payload);
    const inv = (await db.query<{ group_id: string }>('SELECT group_id FROM share_invites WHERE id=$1 AND revoked_at IS NULL', [v.id])).rows[0];
    if (!inv) throw new AppError('Link não encontrado.', 404);
    await ownerOf(db, user, inv.group_id);
    await db.query('UPDATE share_invites SET revoked_at=now() WHERE id=$1', [v.id]);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  if (action === 'invite.join') {
    const v = z.object({ token: inviteToken, claim_member_id: id.optional() }).parse(payload);
    const group = await joinByInvite(db, v.token, v.claim_member_id);
    await audit(db, user, action, group);
    return { id: group };
  }
  if (action === 'shared.dismiss_notice') {
    const v = z.object({ expense_id: id }).parse(payload);
    await db.query('UPDATE shared_postings SET notice=NULL WHERE user_id=$1 AND expense_id=$2', [user, v.expense_id]);
    return { id: v.expense_id };
  }
  throw new AppError('Operação não reconhecida.', 404);
}
