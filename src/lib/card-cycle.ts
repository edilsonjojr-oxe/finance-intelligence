// Ciclo da fatura do cartão: fechada (aguardando pagamento) × aberta (ainda recebendo compras),
// parcelas futuras ("PARC 03/10") e limite disponível. Cálculos puros, sem gravar nada.
import { cents, decimal } from './money';
import type { Account, Movement } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Data com o dia limitado ao fim do mês (dia 31 em fevereiro → 28/29). */
export const dayOf = (y: number, m: number, d: number) => {
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
};
const ym = (date: string) => date.split('-').map(Number) as [number, number, number];
export const addMonths = (date: string, n: number) => { const [y, m, d] = ym(date); return dayOf(y, m + n, d); };

/** Fechamento mais recente até hoje (inclusive) e o próximo. */
export function closings(today: string, closingDay: number) {
  const [y, m] = ym(today);
  const thisMonth = dayOf(y, m, closingDay);
  const last = thisMonth <= today ? thisMonth : dayOf(y, m - 1, closingDay);
  return { last, next: addMonths(last, 1) };
}
/** Vencimento da fatura que fecha em `closing`: primeiro dia de vencimento depois do fechamento. */
export function dueAfter(closing: string, dueDay: number) {
  const [y, m] = ym(closing);
  const same = dayOf(y, m, dueDay);
  return same > closing ? same : dayOf(y, m + 1, dueDay);
}

const PARC = /parc(?:ela)?\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})/i;
export type FutureInstallment = { account_id: string; description: string; amount: string; date: string; number: number; total: number };
/**
 * Parcelas que ainda virão em próximas faturas. Para cada compra parcelada, usa a parcela mais
 * recente já lançada (ex.: 03/10) e projeta 04..10 mês a mês. Quando a próxima fatura for lida,
 * a parcela real substitui a projeção automaticamente.
 */
export function futureInstallments(transactions: Movement[], cardIds: Set<string>): FutureInstallment[] {
  const latest = new Map<string, { t: Movement; n: number; total: number }>();
  for (const t of transactions) {
    if (t.status !== 'posted' || t.kind !== 'expense' || !cardIds.has(t.account_id)) continue;
    const m = t.description.match(PARC);
    if (!m) continue;
    const n = Number(m[1]), total = Number(m[2]);
    if (!total || n >= total || total > 48) continue;
    const key = `${t.account_id}|${t.description.replace(PARC, '').trim().toLowerCase()}|${t.amount}|${total}`;
    const cur = latest.get(key);
    if (!cur || n > cur.n) latest.set(key, { t, n, total });
  }
  const out: FutureInstallment[] = [];
  for (const { t, n, total } of latest.values())
    for (let k = n + 1; k <= total; k++)
      out.push({ account_id: t.account_id, description: t.description.replace(PARC, `PARC ${pad(k)}/${pad(total)}`), amount: t.amount, date: addMonths(t.date, k - n), number: k, total });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type CardStatus = {
  debt: bigint; closed: bigint; open: bigint; future: bigint;
  closedDue: string | null; openCloses: string | null; openDue: string | null;
  available: bigint | null; usage: number | null;
  /** Fechamento estimado (cartão sem dia de fechamento informado): vencimento − 7 dias. */
  estimatedClosing: boolean;
};
/** Dia de fechamento: o informado ou, sem ele, uma estimativa de 7 dias antes do vencimento. */
export const closingDayOf = (card: Pick<Account, 'closing_day' | 'due_day'>) =>
  card.closing_day || (card.due_day ? (card.due_day > 7 ? card.due_day - 7 : card.due_day + 23) : null);
/**
 * Situação do cartão hoje. Sem dia de fechamento, toda a dívida é tratada como uma fatura só.
 * `closed` = compras até o último fechamento ainda não pagas; `open` = compras depois dele.
 */
export function cardStatus(card: Pick<Account, 'id' | 'balance' | 'closing_day' | 'due_day' | 'credit_limit'>, transactions: Movement[], today: string): CardStatus {
  const debt = cents(card.balance) < 0n ? -cents(card.balance) : 0n;
  let open = 0n;
  let closedDue: string | null = null, openCloses: string | null = null, openDue: string | null = null;
  const closingDay = closingDayOf(card);
  if (closingDay) {
    const { last, next } = closings(today, closingDay);
    for (const t of transactions)
      if (t.status === 'posted' && t.account_id === card.id && t.date > last && t.date <= today && t.kind !== 'transfer')
        open += t.kind === 'expense' ? cents(t.amount) : -cents(t.amount);
    if (open < 0n) open = 0n;
    if (open > debt) open = debt;
    openCloses = next;
    if (card.due_day) { closedDue = dueAfter(last, card.due_day); openDue = dueAfter(next, card.due_day); }
  }
  const future = futureInstallments(transactions, new Set([card.id])).reduce((n, f) => n + cents(f.amount), 0n);
  const limit = card.credit_limit ? cents(card.credit_limit) : null;
  const used = debt + future;
  return {
    debt, closed: debt - open, open, future, closedDue, openCloses, openDue,
    available: limit === null ? null : limit - used,
    usage: limit ? Number((used * 1000n) / limit) / 10 : null,
    estimatedClosing: !card.closing_day && !!closingDay,
  };
}
export const fmtCents = (v: bigint) => decimal(v);
