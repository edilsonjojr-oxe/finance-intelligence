// Orçamentos, metas e relatórios: cálculos puros a partir dos dados já carregados.
import { cents, decimal } from './money';
import { categoryBreakdown } from './finance';
import { merchantKey, SEPARATOR } from './categorize';
import type { Account, Budget, Goal, Movement, Split } from './types';

export type BudgetStatus = Budget & { spent: bigint; pct: number; level: 'ok' | 'warn' | 'over' };
/** Gasto do mês contra o orçamento. Orçamento de grupo soma todas as subcategorias. */
export function budgetStatus(budgets: Budget[], transactions: Movement[], splits: Split[], month: string): BudgetStatus[] {
  const groups = categoryBreakdown(transactions, splits, month);
  return budgets.map((b): BudgetStatus => {
    const [group, ...rest] = b.category.split(SEPARATOR);
    const g = groups.find((x) => x.group === group);
    const spent = !g ? 0n : rest.length ? g.subs.find((s) => s.name === rest.join(SEPARATOR))?.total || 0n : g.total;
    const limit = cents(b.amount);
    const pct = limit ? Number((spent * 1000n) / limit) / 10 : 0;
    return { ...b, spent, pct, level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
  }).sort((a, b) => b.pct - a.pct);
}

export type GoalProgress = { current: bigint; pct: number; monthly: bigint | null; monthsLeft: number | null };
/** Progresso da meta: saldo da conta vinculada ou valor guardado informado; quanto guardar por mês. */
export function goalProgress(goal: Goal, accounts: Account[], today: string): GoalProgress {
  const acc = goal.account_id ? accounts.find((a) => a.id === goal.account_id) : null;
  const current = acc ? (cents(acc.balance) > 0n ? cents(acc.balance) : 0n) : cents(goal.saved);
  const target = cents(goal.target);
  const pct = Math.min(100, Number((current * 1000n) / target) / 10);
  if (!goal.deadline) return { current, pct, monthly: null, monthsLeft: null };
  const [y1, m1] = today.split('-').map(Number), [y2, m2] = goal.deadline.split('-').map(Number);
  const monthsLeft = Math.max(1, (y2 - y1) * 12 + (m2 - m1));
  const missing = target > current ? target - current : 0n;
  return { current, pct, monthly: missing / BigInt(monthsLeft) + (missing % BigInt(monthsLeft) ? 1n : 0n), monthsLeft };
}

/** Últimos `n` meses (AAAA-MM), do mais antigo ao atual. */
export function lastMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}
/** Gasto por grupo em cada mês (linhas = grupos, colunas = meses). */
export function monthlyByGroup(transactions: Movement[], splits: Split[], months: string[]) {
  const table = new Map<string, bigint[]>();
  months.forEach((month, i) => {
    for (const g of categoryBreakdown(transactions, splits, month)) {
      const row = table.get(g.group) || months.map(() => 0n);
      row[i] += g.total;
      table.set(g.group, row);
    }
  });
  return [...table.entries()].map(([group, values]) => ({ group, values })).sort((a, b) => (b.values.at(-1)! > a.values.at(-1)! ? 1 : -1));
}
/** Estabelecimentos com maior gasto no mês. */
export function topMerchants(transactions: Movement[], month: string, limit = 8) {
  const map = new Map<string, { name: string; total: bigint; count: number }>();
  for (const t of transactions) {
    if (t.status !== 'posted' || t.kind !== 'expense' || !t.date.startsWith(month)) continue;
    const key = merchantKey(t.description) || t.description.toLowerCase();
    const cur = map.get(key) || { name: t.description.replace(/parc(?:ela)?\.?\s*\d+\s*\/\s*\d+/i, '').trim(), total: 0n, count: 0 };
    cur.total += cents(t.amount); cur.count++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (b.total > a.total ? 1 : -1)).slice(0, limit);
}

/** CSV (separador ;) dos lançamentos do período, com as partes das compras divididas. */
export function transactionsCsv(transactions: Movement[], splits: Split[], accounts: Account[], from: string, to: string) {
  const safe = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name || '';
  const rows = [['data', 'descricao', 'tipo', 'valor', 'categoria', 'parte', 'conta', 'destino', 'situacao']];
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.date < from || t.date > to) continue;
    const parts = splits.filter((s) => s.transaction_id === t.id);
    const base = [t.date, t.description, t.kind, t.amount.replace('.', ',')];
    const tail = [name(t.account_id), name(t.destination_account_id), t.status];
    if (parts.length) for (const p of parts) rows.push([...base.slice(0, 3), p.amount.replace('.', ','), p.category, p.description || 'parte', ...tail]);
    else rows.push([...base, t.category, '', ...tail]);
  }
  return '﻿' + rows.map((r) => r.map(safe).join(';')).join('\r\n');
}
export const money = (v: bigint) => decimal(v);
