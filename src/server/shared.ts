// Despesas compartilhadas. Regra de ouro: cada usuário só grava no PRÓPRIO ledger, dentro da
// própria sessão (RLS por app.user_id). Tabelas do grupo são visíveis só a membros (fi_is_member).
//
// Modelo contábil (sem dupla contagem):
//  - Quem pagou: despesa = só a própria parte; o restante vai por transferência para a conta
//    "Valores a receber" (não é gasto). Saldo bancário sai o total, como no extrato.
//  - Participante: a parte vira compromisso "a pagar para Fulano"; vira despesa ao ser quitado.
//  - Reembolso recebido: transferência "Valores a receber" → conta (não é receita).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './auth';
import type { DB } from './db';
import { audit, insertMovement } from './finance-service';
import { cents, decimal, localToday, validDate } from '../lib/money';
import { cleanCategory, UNCATEGORIZED } from '../lib/categorize';
import { computeSplit, memberBalances } from '../lib/split';
import { financialDescription } from '../lib/intake';

const id = z.string().uuid();
const money = z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).refine((v) => cents(v) > 0n, 'O valor deve ser positivo.');
const date = z.string().refine(validDate, 'Data inválida.');
type Member = { id: string; group_id: string; user_id: string | null; display_name: string; role: string; auto_post: boolean; auto_account_id: string | null; removed_at: string | null };
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
    }
  }
}

/** Sincroniza o ledger do usuário (ajustes e lançamento automático) e devolve o estado do módulo. */
export async function sharedState(db: DB, user: string) {
  const memberships = (await db.query<Member>('SELECT * FROM share_members WHERE user_id=$1 AND removed_at IS NULL', [user])).rows;
  if (memberships.length) {
    await reconcile(db, user);
    for (const me of memberships.filter((m) => m.auto_post)) {
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
  const groups = [];
  for (const g of (await db.query<{ id: string; name: string; kind: string; status: string; created_by: string }>(
    'SELECT g.id,g.name,g.kind,g.status,g.created_by FROM share_groups g JOIN share_members m ON m.group_id=g.id AND m.user_id=$1 AND m.removed_at IS NULL ORDER BY g.created_at', [user])).rows) {
    const members = (await db.query<Member>('SELECT * FROM share_members WHERE group_id=$1 ORDER BY created_at', [g.id])).rows;
    const me = members.find((m) => m.user_id === user)!;
    const expenses = (await db.query<Expense>('SELECT id,group_id,created_by,payer_member_id,description,total::text,date::text,category,split_mode,version,deleted_at FROM shared_expenses WHERE group_id=$1 AND deleted_at IS NULL ORDER BY date DESC, created_at DESC', [g.id])).rows;
    const shares = (await db.query<{ expense_id: string; member_id: string; amount: string }>('SELECT expense_id,member_id,amount::text FROM shared_shares WHERE group_id=$1', [g.id])).rows;
    const settlements = (await db.query<{ id: string; from_member_id: string; to_member_id: string; amount: string; date: string; status: string }>('SELECT id,from_member_id,to_member_id,amount::text,date::text,status FROM shared_settlements WHERE group_id=$1 ORDER BY created_at DESC', [g.id])).rows;
    const shareMap = (e: string) => Object.fromEntries(shares.filter((s) => s.expense_id === e).map((s) => [s.member_id, s.amount]));
    const balances = memberBalances(members.map((m) => m.id), expenses.map((e) => ({ payer: e.payer_member_id, total: e.total, shares: shareMap(e.id) })),
      settlements.map((s) => ({ from: s.from_member_id, to: s.to_member_id, amount: s.amount, status: s.status })));
    groups.push({
      id: g.id, name: g.name, kind: g.kind, status: g.status, owner: g.created_by === user, my_member_id: me.id, auto_post: me.auto_post, auto_account_id: me.auto_account_id,
      members: members.map((m) => ({ id: m.id, user_id: m.user_id, name: m.display_name, role: m.role, removed: !!m.removed_at, me: m.user_id === user })),
      expenses: expenses.map((e) => ({ id: e.id, description: e.description, total: e.total, date: e.date, category: e.category, payer_member_id: e.payer_member_id, split_mode: e.split_mode, mine: e.created_by === user, shares: shareMap(e.id) })),
      settlements, balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, decimal(v)])),
    });
  }
  const posted = new Set((await db.query<{ expense_id: string; role: string }>('SELECT expense_id,role FROM shared_postings WHERE user_id=$1 AND expense_id IS NOT NULL', [user])).rows.map((r) => `${r.expense_id}|${r.role}`));
  const pendingRole = (g: { my_member_id: string }, e: { id: string; payer_member_id: string; shares: Record<string, string> }) =>
    e.payer_member_id === g.my_member_id ? !posted.has(`${e.id}|payer`) : cents(e.shares[g.my_member_id] || '0') > 0n && !posted.has(`${e.id}|participant`);
  const inbox = groups.flatMap((g) => g.expenses.filter((e) => pendingRole(g, e))
    .map((e) => ({ expense_id: e.id, group_id: g.id, group_name: g.name, description: e.description, total: e.total, date: e.date, my_share: e.shares[g.my_member_id] || '0.00', i_am_payer: e.payer_member_id === g.my_member_id, payer_name: g.members.find((m) => m.id === e.payer_member_id)?.name || '' })));
  const notices = (await db.query<{ expense_id: string; notice: string }>('SELECT expense_id,notice FROM shared_postings WHERE user_id=$1 AND notice IS NOT NULL ORDER BY created_at DESC LIMIT 20', [user])).rows;
  return { connections, groups, inbox, notices };
}

const expenseSchema = z.object({
  group_id: id, description: z.string().trim().min(1).max(160), total: money, date, category: z.string().trim().max(80).default(''),
  payer_member_id: id, mode: z.enum(['equal', 'selected', 'exact', 'percent']),
  selected: z.array(id).max(100).default([]), exact: z.record(z.string(), z.string().max(20)).default({}), percent: z.record(z.string(), z.string().max(8)).default({}),
  account_id: id.optional(), source_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

async function writeExpense(db: DB, user: string, v: z.infer<typeof expenseSchema>, existing?: Expense) {
  const group = (await db.query<{ status: string }>('SELECT status FROM share_groups WHERE id=$1', [v.group_id])).rows[0];
  if (!group) throw new AppError('Grupo não encontrado.', 404);
  if (group.status !== 'active') throw new AppError('Grupo encerrado: não aceita novos lançamentos.', 409);
  const me = await myMember(db, user, v.group_id);
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
    const v = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(['home', 'trip', 'event', 'other']).default('home'), member_user_ids: z.array(id).min(1).max(30) }).parse(payload);
    for (const other of v.member_user_ids) if (!(await connected(db, user, other))) throw new AppError('Só é possível incluir pessoas conectadas a você.', 403);
    const key = randomUUID();
    await db.query('INSERT INTO share_groups(id,name,kind,created_by) VALUES($1,$2,$3,$4)', [key, v.name, v.kind, user]);
    const names = new Map((await db.query<{ id: string; name: string }>('SELECT id,name FROM users WHERE id = ANY($1::uuid[])', [[user, ...v.member_user_ids]])).rows.map((u) => [u.id, u.name]));
    await db.query("INSERT INTO share_members(id,group_id,user_id,display_name,role) VALUES($1,$2,$3,$4,'owner')", [randomUUID(), key, user, names.get(user) || 'Eu']);
    for (const other of [...new Set(v.member_user_ids)].filter((x) => x !== user))
      await db.query("INSERT INTO share_members(id,group_id,user_id,display_name) VALUES($1,$2,$3,$4)", [randomUUID(), key, other, names.get(other) || 'Membro']);
    await audit(db, user, action, key, { members: v.member_user_ids.length + 1 });
    return { id: key };
  }
  if (action === 'group.settings') {
    const v = z.object({ group_id: id, auto_post: z.boolean(), auto_account_id: z.union([id, z.literal('')]).default('') }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    if (v.auto_account_id && !(await db.query("SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2 AND type<>'receivable'", [v.auto_account_id, user])).rows.length) throw new AppError('Conta não encontrada.', 404);
    await db.query('UPDATE share_members SET auto_post=$1,auto_account_id=$2 WHERE id=$3', [v.auto_post, v.auto_account_id || null, me.id]);
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
    // Quem deve marca o pagamento: quita no PRÓPRIO ledger as partes em aberto devidas a esse membro.
    const v = z.object({ group_id: id, to_member_id: id, account_id: id, date }).parse(payload);
    const me = await myMember(db, user, v.group_id);
    if (v.to_member_id === me.id) throw new AppError('Escolha outra pessoa.');
    if (v.date > localToday()) throw new AppError('A data não pode ser futura.');
    const open = (await db.query<{ obligation_id: string; amount: string; description: string; category: string; due: string }>(
      `SELECT p.obligation_id, o.amount::text, o.description, o.category, o.due_date::text AS due FROM shared_postings p
       JOIN shared_expenses e ON e.id=p.expense_id JOIN obligations o ON o.id=p.obligation_id AND o.user_id=$1
       WHERE p.user_id=$1 AND p.role='participant' AND o.status='open' AND e.group_id=$2 AND e.payer_member_id=$3`, [user, v.group_id, v.to_member_id])).rows;
    if (!open.length) throw new AppError('Nada em aberto para essa pessoa. Lance antes as partes pendentes em "Para lançar".');
    let total = 0n;
    for (const o of open) {
      const tx = await insertMovement(db, user, { account_id: v.account_id, kind: 'expense', amount: o.amount, date: v.date, competence: o.due, description: o.description, category: o.category }, { source: 'shared' });
      await db.query("UPDATE obligations SET status='paid',settled_transaction_id=$1 WHERE id=$2 AND user_id=$3", [tx, o.obligation_id, user]);
      total += cents(o.amount);
    }
    const key = randomUUID();
    await db.query('INSERT INTO shared_settlements(id,group_id,from_member_id,to_member_id,amount,date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [key, v.group_id, me.id, v.to_member_id, decimal(total), v.date, user]);
    await db.query("INSERT INTO shared_postings(id,user_id,settlement_id,role) VALUES($1,$2,$3,'settle_paid')", [randomUUID(), user, key]);
    await audit(db, user, action, key, { amount: decimal(total), parts: open.length });
    return { id: key, amount: decimal(total) };
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
    if (!v.account_id) throw new AppError('Escolha a conta onde o dinheiro entrou.');
    const rec = await receivableAccount(db, user);
    const transfer = await insertMovement(db, user, { account_id: rec, destination_account_id: v.account_id, kind: 'transfer', amount: s.amount, date: s.date, competence: s.date, description: 'Reembolso de despesa compartilhada', category: 'Transferência interna' }, { source: 'shared' });
    await db.query("UPDATE shared_settlements SET status='confirmed',confirmed_at=now() WHERE id=$1", [s.id]);
    await db.query("INSERT INTO shared_postings(id,user_id,settlement_id,role,transfer_id) VALUES($1,$2,$3,'settle_received',$4)", [randomUUID(), user, s.id, transfer]);
    await audit(db, user, action, s.id, { amount: s.amount });
    return { id: s.id };
  }
  if (action === 'shared.dismiss_notice') {
    const v = z.object({ expense_id: id }).parse(payload);
    await db.query('UPDATE shared_postings SET notice=NULL WHERE user_id=$1 AND expense_id=$2', [user, v.expense_id]);
    return { id: v.expense_id };
  }
  throw new AppError('Operação não reconhecida.', 404);
}
