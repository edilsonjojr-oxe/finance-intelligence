import { addDays, cents, decimal } from "./money";
import type { Account, Movement, Obligation, ForecastPoint } from "./types";
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
): ForecastPoint[] {
  let balance = accounts.reduce((sum, a) => sum + cents(a.balance), 0n);
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
    const expense = due
      .filter((o) => o.kind === "expense")
      .reduce((n, o) => n + cents(o.amount), 0n);
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
