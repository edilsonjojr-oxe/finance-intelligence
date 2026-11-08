import { describe, expect, it } from 'vitest';
import { addMonths, cardStatus, closings, dueAfter, futureInstallments } from '../src/lib/card-cycle';
import { forecast } from '../src/lib/finance';
import type { Account, Movement } from '../src/lib/types';

const tx = (date: string, amount: string, description: string, extra: Partial<Movement> = {}) =>
  ({ id: description + date, account_id: 'k', destination_account_id: null, kind: 'expense', amount, date, competence: date, description, category: 'Outros', status: 'posted', source: 'manual', ...extra }) as Movement;
const card = (balance: string, extra: Partial<Account> = {}) =>
  ({ id: 'k', name: 'Cartão', institution: '', type: 'credit_card', opening_balance: '0', opening_date: '2026-01-01', balance, closing_day: 3, due_day: 10, credit_limit: '1000.00', ...extra }) as Account;

describe('Ciclo da fatura', () => {
  it('fechamento e vencimento, inclusive fim de mês', () => {
    expect(closings('2026-11-08', 3)).toEqual({ last: '2026-11-03', next: '2026-12-03' });
    expect(closings('2026-11-02', 3)).toEqual({ last: '2026-10-03', next: '2026-11-03' });
    expect(dueAfter('2026-11-03', 10)).toBe('2026-11-10');
    expect(dueAfter('2026-11-28', 5)).toBe('2026-12-05');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });
  it('separa fatura fechada (até o fechamento) e aberta (depois dele)', () => {
    const txs = [tx('2026-10-20', '300.00', 'MERCADO'), tx('2026-11-05', '100.00', 'IFOOD'), tx('2026-11-06', '20.00', 'ESTORNO', { kind: 'income' })];
    const st = cardStatus(card('-380.00'), txs, '2026-11-08');
    expect([st.closed, st.open, st.closedDue, st.openCloses, st.openDue]).toEqual([30000n, 8000n, '2026-11-10', '2026-12-03', '2026-12-10']);
    expect(st.available).toBe(62000n);
  });
  it('projeta parcelas futuras a partir da última lançada e some quando a real chega', () => {
    const one = [tx('2026-10-15', '100.00', 'LOJA X PARC 03/05')];
    expect(futureInstallments(one, new Set(['k'])).map((f) => [f.description, f.date])).toEqual([
      ['LOJA X PARC 04/05', '2026-11-15'], ['LOJA X PARC 05/05', '2026-12-15'],
    ]);
    const two = [...one, tx('2026-11-15', '100.00', 'LOJA X PARC 04/05')];
    expect(futureInstallments(two, new Set(['k'])).map((f) => f.number)).toEqual([5]);
    expect(cardStatus(card('-200.00'), two, '2026-11-20').future).toBe(10000n);
  });
  it('limite considera parcelas futuras e alerta acima de 90%', () => {
    const st = cardStatus(card('-850.00'), [tx('2026-10-15', '50.00', 'TV PARC 01/02')], '2026-11-08');
    expect(st.available).toBe(10000n);
    expect(st.usage).toBe(90);
  });
  it('projeção: fechada no vencimento, aberta no seguinte, parcela futura no mês dela', () => {
    const accounts = [
      { id: 'c', name: 'Conta', institution: '', type: 'checking', opening_balance: '0', opening_date: '2026-01-01', balance: '5000.00' } as Account,
      card('-400.00'),
    ];
    const txs = [tx('2026-10-20', '300.00', 'MERCADO'), tx('2026-11-05', '100.00', 'LOJA PARC 01/02')];
    const p = forecast(accounts, [], '2026-11-08', 70, false, txs);
    const at = (d: string) => p.find((x) => x.date === d)!;
    expect(at('2026-11-10').expense).toBe('300.00');
    expect(at('2026-12-10').expense).toBe('100.00');
    expect(at('2027-01-10').expense).toBe('100.00');
    expect(p.at(-1)!.balance).toBe('4500.00');
  });
});
