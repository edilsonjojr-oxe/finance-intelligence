import { describe, expect, it } from 'vitest';
import { cardBillSchedule, forecast } from '../src/lib/finance';
import type { Account, Movement } from '../src/lib/types';

// Dados fictícios: cartão sem dia de fechamento, vencimento dia 2, fatura de outubro não paga.
const card = { id: 'c', name: 'Cartão X', institution: '', type: 'credit_card', opening_balance: '0', opening_date: '2026-06-01', balance: '-1000.00', due_day: 2, closing_day: null } as Account;
const bank = { id: 'b', name: 'Conta', institution: '', type: 'checking', opening_balance: '0', opening_date: '2026-06-01', balance: '600.00' } as Account;
const buy = (id: string, date: string, amount: string) => ({ id, account_id: 'c', destination_account_id: null, kind: 'expense', amount, date, competence: date, description: 'Compra', category: 'Outros', status: 'posted' }) as Movement;
const txs = [buy('1', '2026-10-05', '700.00'), buy('2', '2026-10-20', '300.00')];

describe('faturas de cartão na projeção', () => {
  it('sem fechamento informado, estima (vencimento − 7) e marca a fatura vencida como atrasada', () => {
    const bills = cardBillSchedule([card, bank], txs, '2026-11-08');
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ dueDate: '2026-11-02', date: '2026-11-08', overdue: true, estimated: true, kind: 'closed' });
    expect(bills[0].amount).toBe(100000n);
  });
  it('a fatura vencida entra hoje na projeção, não no mês seguinte', () => {
    const p = forecast([card, bank], [], '2026-11-08', 30, false, txs);
    expect(p[0].balance).toBe('-400.00');
  });
  it('compra depois do fechamento estimado vai para a próxima fatura', () => {
    const bills = cardBillSchedule([{ ...card, balance: '-1200.00' }, bank], [...txs, buy('3', '2026-11-01', '200.00')], '2026-11-08');
    expect(bills.map((b) => [b.kind, b.dueDate, String(b.amount), b.overdue])).toEqual([['closed', '2026-11-02', '100000', true], ['open', '2026-12-02', '20000', false]]);
  });
  it('com fechamento informado, usa o dia informado', () => {
    const bills = cardBillSchedule([{ ...card, closing_day: 22 }, bank], txs, '2026-11-08');
    expect(bills[0]).toMatchObject({ estimated: false, overdue: true });
  });
});
