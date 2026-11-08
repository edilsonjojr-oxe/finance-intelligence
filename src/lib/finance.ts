import { addDays, cents, decimal } from "./money";
import { cardStatus, closings, dueAfter, futureInstallments } from "./card-cycle";
import type { Account, Movement, Obligation, ForecastPoint, Split } from "./types";
export function balanceFor(
  account: Pick<Account, "id" | "opening_balance" | "opening_date">,
  transactions: Movement[],
  today: string,
): string {
  let balance = cents(account.opening_balance);
  for (const item of transactions) {
    if (
      item.status !== "posted" ||
      item.date > today ||
      item.date < account.opening_date
    )
      continue;
    const amount = cents(item.amount);
    if (item.account_id === account.id)
      balance += item.kind === "income" ? amount : -amount;
    if (item.destination_account_id === account.id) balance += amount;
  }
  return decimal(balance);
}
export const isCard = (a: Pick<Account, "type">) => a.type === "credit_card";

export type CategoryGroupTotal = { group: string; total: bigint; subs: { name: string; total: bigint }[] };
/**
 * Despesas do mês por grupo e subcategoria. Lançamentos divididos entram pelas partes;
 * os demais pela própria categoria. Estornados e transferências ficam de fora.
 */
export function categoryBreakdown(
  transactions: Movement[],
  splits: Split[],
  month: string,
): CategoryGroupTotal[] {
  const byTx = new Map<string, Split[]>();
  for (const s of splits) byTx.set(s.transaction_id, [...(byTx.get(s.transaction_id) || []), s]);
  const groups = new Map<string, Map<string, bigint>>();
  const add = (category: string, amount: bigint) => {
    const [group, ...rest] = category.split(" / ");
    const sub = rest.join(" / ") || "Geral";
    const subs = groups.get(group) || new Map<string, bigint>();
    subs.set(sub, (subs.get(sub) || 0n) + amount);
    groups.set(group, subs);
  };
  for (const t of transactions) {
    if (t.status !== "posted" || t.kind !== "expense" || !t.date.startsWith(month)) continue;
    const parts = byTx.get(t.id);
    if (parts?.length) for (const p of parts) add(p.category, cents(p.amount));
    else add(t.category, cents(t.amount));
  }
  return [...groups.entries()]
    .map(([group, subs]) => ({
      group,
      total: [...subs.values()].reduce((n, v) => n + v, 0n),
      subs: [...subs.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => (a.total > b.total ? -1 : 1)),
    }))
    .sort((a, b) => (a.total > b.total ? -1 : 1));
}
/** Próxima data com o dia de vencimento (hoje incluso); dia 31 vira o último dia do mês. */
export function nextDueDate(today: string, dueDay: number) {
  const [y, m, d] = today.split("-").map(Number);
  const build = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
  };
  const thisMonth = build(y, m);
  if (Math.min(dueDay, new Date(Date.UTC(y, m, 0)).getUTCDate()) >= d) return thisMonth;
  return m === 12 ? build(y + 1, 1) : build(y, m + 1);
}
export function totals(transactions: Movement[], month: string) {
  let income = 0n,
    expense = 0n;
  for (const t of transactions.filter(
    (t) => t.status === "posted" && t.date.startsWith(month),
  )) {
    if (t.kind === "income") income += cents(t.amount);
    if (t.kind === "expense") expense += cents(t.amount);
  }
  return {
    income: decimal(income),
    expense: decimal(expense),
    net: decimal(income - expense),
    savingsRate:
      income === 0n
        ? null
        : Number(((income - expense) * 10000n) / income) / 100,
  };
}
export function forecast(
  accounts: Account[],
  obligations: Obligation[],
  today: string,
  days = 30,
  includeEstimates = false,
  transactions: Movement[] = [],
): ForecastPoint[] {
  // Dinheiro disponível = contas que não são cartão. A dívida de cada cartão entra como
  // saída no vencimento da fatura (pagamento), em vez de reduzir o saldo hoje.
  let balance = accounts
    .filter((a) => !isCard(a))
    .reduce((sum, a) => sum + cents(a.balance), 0n);
  const cardBills: { date: string; amount: bigint }[] = [];
  for (const a of accounts.filter(isCard)) {
    const st = cardStatus(a, transactions, today);
    if (a.closing_day && a.due_day) {
      // Fatura fechada no seu vencimento; a aberta no vencimento seguinte.
      if (st.closed > 0n) cardBills.push({ date: st.closedDue! < today ? today : st.closedDue!, amount: st.closed });
      if (st.open > 0n) cardBills.push({ date: st.openDue!, amount: st.open });
    } else if (st.debt > 0n) cardBills.push({ date: a.due_day ? nextDueDate(today, a.due_day) : today, amount: st.debt });
    // Parcelas futuras ("PARC 04/10"…) entram na fatura do mês em que caem.
    for (const f of futureInstallments(transactions, new Set([a.id]))) {
      const date = a.closing_day && a.due_day
        ? dueAfter(f.date <= closings(f.date, a.closing_day).last ? closings(f.date, a.closing_day).last : closings(f.date, a.closing_day).next, a.due_day)
        : a.due_day ? nextDueDate(f.date, a.due_day) : f.date;
      cardBills.push({ date, amount: cents(f.amount) });
    }
  }
  const result: ForecastPoint[] = [];
  for (let day = 0; day < days; day++) {
    const date = addDays(today, day);
    const due = obligations.filter(
      (o) =>
        o.status === "open" &&
        (includeEstimates || o.stage !== 'estimated') &&
        (o.due_date === date || (day === 0 && o.due_date < today)),
    );
    const income = due
      .filter((o) => o.kind === "income")
      .reduce((n, o) => n + cents(o.amount), 0n);
    const expense =
      due
        .filter((o) => o.kind === "expense")
        .reduce((n, o) => n + cents(o.amount), 0n) +
      cardBills.filter((b) => b.date === date).reduce((n, b) => n + b.amount, 0n);
    balance += income - expense;
    result.push({
      date,
      balance: decimal(balance),
      income: decimal(income),
      expense: decimal(expense),
    });
  }
  return result;
}
