// Motor único de divisão de despesas (usado na UI e revalidado no servidor).
// Centavos determinísticos: 100,00 / 3 = 33,34 + 33,33 + 33,33 (sobra vai para os primeiros).
import { cents, decimal } from './money';

export type SplitMode = 'equal' | 'selected' | 'exact' | 'percent';
export type SplitInput = {
  total: string;
  mode: SplitMode;
  members: string[];               // ordem estável dos membros do grupo
  selected?: string[];             // modo "selected"
  exact?: Record<string, string>;  // modo "exact": valor por membro
  percent?: Record<string, string>; // modo "percent": % por membro (até 2 casas)
};
export type SplitResult = { ok: true; shares: Record<string, string> } | { ok: false; error: string; remaining?: string };

function evenly(total: bigint, ids: string[]) {
  const n = BigInt(ids.length), base = total / n;
  let rest = total - base * n;
  const out: Record<string, string> = {};
  for (const id of ids) { const extra = rest > 0n ? 1n : 0n; rest -= extra; out[id] = decimal(base + extra); }
  return out;
}
const parse = (v: string | undefined) => { try { return cents((v || '0').includes(',') ? v!.replace(/\./g, '').replace(',', '.') : v || '0'); } catch { return null; } };

export function computeSplit(input: SplitInput): SplitResult {
  const total = parse(input.total);
  if (!total || total <= 0n) return { ok: false, error: 'Informe o valor total.' };
  if (!input.members.length) return { ok: false, error: 'O grupo não tem membros.' };
  const zero = Object.fromEntries(input.members.map((m) => [m, '0.00']));
  if (input.mode === 'equal') return { ok: true, shares: { ...zero, ...evenly(total, input.members) } };
  if (input.mode === 'selected') {
    const ids = input.members.filter((m) => input.selected?.includes(m));
    if (!ids.length) return { ok: false, error: 'Selecione ao menos uma pessoa.' };
    return { ok: true, shares: { ...zero, ...evenly(total, ids) } };
  }
  if (input.mode === 'exact') {
    let sum = 0n; const shares: Record<string, string> = {};
    for (const m of input.members) {
      const v = parse(input.exact?.[m]);
      if (v === null || v < 0n) return { ok: false, error: 'Valor inválido em uma das pessoas.' };
      shares[m] = decimal(v); sum += v;
    }
    if (sum !== total) {
      const diff = total - sum;
      return { ok: false, error: diff > 0n ? `Falta distribuir R$ ${decimal(diff).replace('.', ',')}.` : `Passou R$ ${decimal(-diff).replace('.', ',')} do total.`, remaining: decimal(diff) };
    }
    return { ok: true, shares };
  }
  // Percentual: em centésimos de ponto (10000 = 100%); restos distribuídos pelos maiores.
  const bp: Record<string, bigint> = {};
  let sumBp = 0n;
  for (const m of input.members) {
    const raw = (input.percent?.[m] || '0').replace(',', '.');
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return { ok: false, error: 'Percentual inválido.' };
    const v = BigInt(Math.round(Number(raw) * 100)); bp[m] = v; sumBp += v;
  }
  if (sumBp !== 10000n) return { ok: false, error: `Os percentuais somam ${(Number(sumBp) / 100).toString().replace('.', ',')}%; precisam somar 100%.` };
  const base: Record<string, bigint> = {}, frac: Record<string, bigint> = {};
  let used = 0n;
  for (const m of input.members) { base[m] = (total * bp[m]) / 10000n; frac[m] = (total * bp[m]) % 10000n; used += base[m]; }
  let rest = total - used;
  for (const m of [...input.members].sort((a, b) => (frac[b] > frac[a] ? 1 : frac[b] < frac[a] ? -1 : 0))) { if (rest <= 0n) break; if (bp[m] > 0n) { base[m] += 1n; rest -= 1n; } }
  return { ok: true, shares: Object.fromEntries(input.members.map((m) => [m, decimal(base[m])])) };
}

/**
 * Saldo líquido por membro: pagou − consumiu − (acertos enviados confirmados) + (recebidos).
 * Positivo = tem a receber; negativo = deve.
 */
export function memberBalances(
  members: string[],
  expenses: { payer: string; total: string; shares: Record<string, string> }[],
  settlements: { from: string; to: string; amount: string; status: string }[],
) {
  const bal = Object.fromEntries(members.map((m) => [m, 0n])) as Record<string, bigint>;
  for (const e of expenses) {
    bal[e.payer] = (bal[e.payer] || 0n) + cents(e.total);
    for (const [m, v] of Object.entries(e.shares)) bal[m] = (bal[m] || 0n) - cents(v);
  }
  for (const s of settlements) if (s.status === 'confirmed') { bal[s.from] = (bal[s.from] || 0n) + cents(s.amount); bal[s.to] = (bal[s.to] || 0n) - cents(s.amount); }
  return bal;
}

/**
 * Simplifica as dívidas: menor número de pagamentos que zera todos os saldos.
 * Guloso (maior devedor paga ao maior credor); no máximo n−1 transferências.
 */
export function simplifyDebts(balances: Record<string, bigint>) {
  const debtors = Object.entries(balances).filter(([, v]) => v < 0n).map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(balances).filter(([, v]) => v > 0n).map(([id, v]) => ({ id, v }));
  const out: { from: string; to: string; amount: string }[] = [];
  const byLargest = (a: { v: bigint }, b: { v: bigint }) => (b.v > a.v ? 1 : b.v < a.v ? -1 : 0);
  while (debtors.length && creditors.length) {
    debtors.sort(byLargest); creditors.sort(byLargest);
    const d = debtors[0], c = creditors[0];
    const pay = d.v < c.v ? d.v : c.v;
    out.push({ from: d.id, to: c.id, amount: decimal(pay) });
    d.v -= pay; c.v -= pay;
    if (d.v === 0n) debtors.shift();
    if (c.v === 0n) creditors.shift();
  }
  return out;
}
