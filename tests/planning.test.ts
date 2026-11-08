import { describe, expect, it } from 'vitest';
import { budgetStatus, goalProgress, lastMonths, monthlyByGroup, topMerchants, transactionsCsv } from '../src/lib/planning';
import type { Account, Movement, Split } from '../src/lib/types';

const tx = (id: string, date: string, amount: string, description: string, category: string, extra: Partial<Movement> = {}) =>
  ({ id, account_id: 'c', destination_account_id: null, kind: 'expense', amount, date, competence: date, description, category, status: 'posted', source: 'manual', ...extra }) as Movement;
const txs = [
  tx('1', '2026-11-02', '300.00', 'ZAFFARI', 'Dividido'),
  tx('2', '2026-11-03', '120.00', 'IFD*PIZZA', 'Alimentação / Delivery'),
  tx('3', '2026-11-04', '90.00', 'IFD*PIZZA', 'Alimentação / Delivery'),
  tx('4', '2026-10-10', '200.00', 'IFD*SUSHI', 'Alimentação / Delivery'),
  tx('5', '2026-11-05', '=1+1', '=HYPERLINK("x")', 'Outros', { amount: '10.00' }),
];
const splits: Split[] = [
  { transaction_id: '1', category: 'Alimentação / Mercado', amount: '240.00', description: '' },
  { transaction_id: '1', category: 'Casa / Cama, mesa e banho', amount: '60.00', description: 'travesseiro' },
];

describe('Orçamentos, metas e relatórios', () => {
  it('orçamento por subcategoria e por grupo, com níveis', () => {
    const st = budgetStatus([
      { category: 'Alimentação / Delivery', amount: '200.00' },
      { category: 'Alimentação', amount: '600.00' },
      { category: 'Casa', amount: '100.00' },
    ], txs, splits, '2026-11');
    expect(st.map((b) => [b.category, b.spent.toString(), b.level])).toEqual([
      ['Alimentação / Delivery', '21000', 'over'],
      ['Alimentação', '45000', 'ok'],
      ['Casa', '6000', 'ok'],
    ]);
    expect(budgetStatus([{ category: 'Alimentação', amount: '500.00' }], txs, splits, '2026-11')[0].level).toBe('warn');
  });
  it('meta: valor guardado ou saldo da conta, e quanto guardar por mês', () => {
    const acc = [{ id: 'p', balance: '1500.00' } as Account];
    expect(goalProgress({ id: 'g', name: 'Reserva', target: '6000.00', saved: '0', deadline: '2027-05-01', account_id: 'p' }, acc, '2026-11-08')).toEqual({ current: 150000n, pct: 25, monthly: 75000n, monthsLeft: 6 });
    expect(goalProgress({ id: 'g', name: 'Viagem', target: '1000.00', saved: '250.00', deadline: null, account_id: null }, acc, '2026-11-08').pct).toBe(25);
  });
  it('mês a mês por grupo e maiores estabelecimentos', () => {
    expect(lastMonths('2027-01', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
    const t = monthlyByGroup(txs, splits, ['2026-10', '2026-11']);
    expect(t.find((r) => r.group === 'Alimentação')!.values).toEqual([20000n, 45000n]);
    const top = topMerchants(txs, '2026-11');
    expect(top[0]).toMatchObject({ name: 'ZAFFARI', total: 30000n });
    expect(top[1]).toMatchObject({ total: 21000n, count: 2 });
  });
  it('CSV com uma linha por parte e neutralização de fórmulas', () => {
    const csv = transactionsCsv(txs.map((t) => (t.id === '5' ? { ...t, amount: '10.00' } : t)), splits, [{ id: 'c', name: 'Conta' } as Account], '2026-11-01', '2026-11-30');
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toBe('2026-11-02;ZAFFARI;expense;240,00;Alimentação / Mercado;parte;Conta;;posted');
    expect(lines[2]).toContain('travesseiro');
    expect(lines.at(-1)!.startsWith("2026-11-05;\"'=HYPERLINK(\"\"x\"\")\"")).toBe(true);
  });
});
