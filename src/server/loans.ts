// Empréstimos, acordos e importação de planilha. Tudo dentro da transação do usuário (RLS).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, hash } from './auth';
import type { DB } from './db';
import { audit, insertMovement } from './finance-service';
import { cents, decimal, localToday, recurrenceDates, validDate } from '../lib/money';
import { cleanCategory, UNCATEGORIZED } from '../lib/categorize';
import { financialDescription } from '../lib/intake';

const id = z.string().uuid();
const money = z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).refine((v) => cents(v) > 0n, 'O valor deve ser positivo.');
const date = z.string().refine(validDate, 'Data inválida.');
const title = z.string().trim().min(1).max(120);
const category = z.string().trim().max(80).default('');
const installment = z.object({ date, amount: money, paid: z.boolean().default(false) });
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

type Installment = z.infer<typeof installment>;
export type Direction = 'payable' | 'receivable';
export const LOAN_TYPES = ['loan', 'agreement', 'financing'];

/** Divide o total em n parcelas iguais em centavos; a diferença de arredondamento vai para a última. */
export function splitTotal(total: string, n: number) {
  const t = cents(total), base = t / BigInt(n);
  return Array.from({ length: n }, (_, i) => decimal(i === n - 1 ? t - base * BigInt(n - 1) : base));
}

/**
 * Cria o contrato e uma obrigação por parcela. Parcelas marcadas como pagas ficam como
 * histórico (pagas fora do app, sem movimento na conta, sem alterar saldos).
 */
export async function createSchedule(db: DB, user: string, v: {
  title: string; counterparty: string; contract_type: string; direction: Direction; category: string;
  installments: Installment[]; note?: string; fingerprint?: string; source?: 'manual' | 'spreadsheet';
}) {
  if (!v.installments.length || v.installments.length > 360) throw new AppError('Informe de 1 a 360 parcelas.');
  const dates = new Set<string>();
  const list = [...v.installments].sort((a, b) => a.date.localeCompare(b.date)).filter((p) => !dates.has(p.date) && dates.add(p.date));
  if (v.fingerprint) {
    const seen = await db.query<{ contract_id: string }>('SELECT contract_id FROM source_events WHERE user_id=$1 AND fingerprint=$2', [user, v.fingerprint]);
    if (seen.rows[0]) return { id: seen.rows[0].contract_id, duplicate: true };
  }
  const key = randomUUID();
  const total = list.reduce((n, p) => n + cents(p.amount), 0n);
  const first = list[0];
  const cat = cleanCategory(v.category) || (v.direction === 'payable' ? 'Dívidas e empréstimos / Parcelas de empréstimo' : 'Receitas / Empréstimos a receber');
  await db.query(
    "INSERT INTO contracts(id,user_id,title,counterparty,amount,start_date,months,due_day,category,adjustment_note,contract_type,total_amount,direction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [key, user, v.title, v.counterparty, first.amount, first.date, list.length, Number(first.date.slice(8, 10)), cat, (v.note || '').slice(0, 1000), v.contract_type, decimal(total), v.direction],
  );
  for (const p of list)
    await db.query(
      "INSERT INTO obligations(id,user_id,contract_id,description,amount,due_date,kind,category,status,stage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'charged')",
      [randomUUID(), user, key, v.title, p.amount, p.date, v.direction === 'payable' ? 'expense' : 'income', cat, p.paid ? 'paid' : 'open'],
    );
  if (v.fingerprint)
    await db.query("INSERT INTO source_events(id,user_id,source_type,fingerprint,source_hash,event_type,contract_id) VALUES($1,$2,$3,$4,$5,'contract',$6)",
      [randomUUID(), user, v.source === 'spreadsheet' ? 'spreadsheet' : 'manual', v.fingerprint, v.fingerprint, key]);
  await audit(db, user, 'loan.created', key, { installments: list.length, paid: list.filter((p) => p.paid).length, direction: v.direction, source: v.source || 'manual' });
  return { id: key, duplicate: false };
}

const loanSchema = z.object({
  direction: z.enum(['payable', 'receivable']),
  counterparty: title,
  title: z.string().trim().max(120).default(''),
  contract_type: z.enum(['loan', 'agreement', 'financing']).default('loan'),
  category,
  note: z.string().trim().max(500).default(''),
  mode: z.enum(['total', 'installment', 'schedule']),
  total_amount: money.optional(),
  installment_amount: money.optional(),
  installments: z.coerce.number().int().min(1).max(360).optional(),
  first_due_date: date.optional(),
  paid_count: z.coerce.number().int().min(0).max(360).default(0),
  schedule: z.array(installment).max(360).optional(),
}).strict();

const sheetSchema = z.object({
  source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  paid_mode: z.enum(['history', 'account']).default('history'),
  account_id: id.optional(),
  monthly: z.array(z.object({ description: z.string().trim().min(1).max(160), amount: money, date, paid: z.boolean(), category })).max(2000).default([]),
  schedules: z.array(z.object({ title, direction: z.enum(['payable', 'receivable']), contract_type: z.enum(['loan', 'agreement', 'financing']).default('loan'), category, installments: z.array(installment).min(1).max(360) })).max(100).default([]),
  recurring: z.array(z.object({ description: z.string().trim().min(1).max(160), amount: money, due_day: z.coerce.number().int().min(1).max(31), months: z.coerce.number().int().min(1).max(36).default(12), category })).max(200).default([]),
}).strict();

export async function loanAction(db: DB, user: string, action: string, payload: unknown) {
  if (action === 'loan.create') {
    const v = loanSchema.parse(payload);
    let list: Installment[];
    if (v.mode === 'schedule') {
      if (!v.schedule?.length) throw new AppError('Informe as parcelas.');
      list = v.schedule;
    } else {
      if (!v.installments || !v.first_due_date) throw new AppError('Informe o número de parcelas e o primeiro vencimento.');
      const dates = recurrenceDates(v.first_due_date, v.installments, Number(v.first_due_date.slice(8, 10)));
      const amounts = v.mode === 'total'
        ? (v.total_amount ? splitTotal(v.total_amount, v.installments) : (() => { throw new AppError('Informe o valor total.'); })())
        : Array(v.installments).fill(v.installment_amount ?? (() => { throw new AppError('Informe o valor da parcela.'); })());
      list = dates.map((d, i) => ({ date: d, amount: amounts[i], paid: i < v.paid_count }));
    }
    const name = v.title || (v.direction === 'payable' ? `Empréstimo com ${v.counterparty}` : `Empréstimo para ${v.counterparty}`);
    return createSchedule(db, user, { title: name, counterparty: v.counterparty, contract_type: v.contract_type, direction: v.direction, category: v.category, installments: list, note: v.note });
  }
  if (action === 'obligation.mark_paid') {
    // Parcela já paga fora do app (histórico): não cria movimento nem altera saldos.
    const v = z.object({ id }).parse(payload);
    const r = await db.query("UPDATE obligations SET status='paid' WHERE id=$1 AND user_id=$2 AND status='open' RETURNING id", [v.id, user]);
    if (!r.rows.length) throw new AppError('Parcela não está em aberto.', 409);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  if (action === 'obligation.reopen') {
    const v = z.object({ id }).parse(payload);
    const r = await db.query("UPDATE obligations SET status='open' WHERE id=$1 AND user_id=$2 AND status='paid' AND settled_transaction_id IS NULL RETURNING id", [v.id, user]);
    if (!r.rows.length) throw new AppError('Só é possível reabrir parcelas marcadas como pagas sem lançamento. Para as demais, estorne o lançamento.', 409);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  if (action === 'sheet.import') {
    const v = sheetSchema.parse(payload);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user]);
    let opening = '';
    if (v.paid_mode === 'account') {
      if (!v.account_id) throw new AppError('Escolha a conta dos pagamentos.');
      const acc = await db.query<{ opening_date: string }>('SELECT opening_date::text FROM accounts WHERE id=$1 AND user_id=$2', [v.account_id, user]);
      if (!acc.rows[0]) throw new AppError('Conta não encontrada.', 404);
      opening = acc.rows[0].opening_date;
    }
    const today = localToday();
    const result = { monthly: 0, payments: 0, history: 0, schedules: 0, recurring: 0, skipped: 0 };
    for (const m of v.monthly) {
      // Identidade pelo conteúdo: reimportar (mesmo com o arquivo editado) não duplica.
      const fingerprint = hash(`sheet-item:${norm(m.description)}|${m.amount}|${m.date}`);
      if ((await db.query('SELECT 1 FROM source_events WHERE user_id=$1 AND fingerprint=$2', [user, fingerprint])).rows.length) { result.skipped++; continue; }
      const cat = cleanCategory(m.category) || UNCATEGORIZED;
      const description = financialDescription(m.description);
      let transactionId: string | null = null;
      if (m.paid && v.paid_mode === 'account' && m.date <= today && m.date >= opening) {
        transactionId = await insertMovement(db, user, { account_id: v.account_id!, kind: 'expense', amount: m.amount, date: m.date, competence: m.date, description, category: cat }, { source: 'spreadsheet' });
        result.payments++;
      } else if (m.paid) result.history++;
      const obligationId = randomUUID();
      await db.query(
        "INSERT INTO obligations(id,user_id,description,amount,due_date,kind,category,status,stage,settled_transaction_id) VALUES($1,$2,$3,$4,$5,'expense',$6,$7,'charged',$8)",
        [obligationId, user, description, m.amount, m.date, cat, m.paid ? 'paid' : 'open', transactionId],
      );
      await db.query("INSERT INTO source_events(id,user_id,source_type,fingerprint,source_hash,event_type,obligation_id,transaction_id) VALUES($1,$2,'spreadsheet',$3,$4,$5,$6,$7)",
        [randomUUID(), user, fingerprint, v.source_hash, m.paid ? 'paid' : 'charged', obligationId, transactionId]);
      result.monthly++;
    }
    for (const s of v.schedules) {
      const first = [...s.installments].sort((a, b) => a.date.localeCompare(b.date))[0];
      const r = await createSchedule(db, user, {
        title: s.title, counterparty: s.title, contract_type: s.contract_type, direction: s.direction, category: s.category, installments: s.installments,
        fingerprint: hash(`sheet-loan:${norm(s.title)}|${s.installments.length}|${first.date}|${first.amount}`), source: 'spreadsheet',
      });
      if (r.duplicate) result.skipped++; else result.schedules++;
    }
    for (const r of v.recurring) {
      const start = nextMonthDay(today, r.due_day);
      const dates = recurrenceDates(start, r.months, r.due_day);
      const created = await createSchedule(db, user, {
        title: r.description, counterparty: r.description, contract_type: 'subscription', direction: 'payable',
        category: r.category || UNCATEGORIZED, installments: dates.map((d) => ({ date: d, amount: r.amount, paid: false })),
        fingerprint: hash(`sheet-recurring:${norm(r.description)}|${r.amount}|${r.due_day}`), source: 'spreadsheet',
      });
      if (created.duplicate) result.skipped++; else result.recurring++;
    }
    await audit(db, user, action, user, { ...result, source_hash: v.source_hash });
    return { id: v.source_hash, ...result };
  }
  throw new AppError('Operação não reconhecida.', 404);
}

/** Próxima data com o dia informado, a partir de hoje (inclusive). */
function nextMonthDay(today: string, day: number) {
  const [y, m, d] = today.split('-').map(Number);
  const build = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate())).padStart(2, '0')}`;
  return day >= d ? build(y, m) : m === 12 ? build(y + 1, 1) : build(y, m + 1);
}
