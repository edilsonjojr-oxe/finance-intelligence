import { describe, expect, it } from 'vitest';
import { computeSplit, memberBalances } from '../src/lib/split';

const members = ['a', 'b', 'c'];
describe('Divisão de despesas', () => {
  it('igual para todos com centavos determinísticos', () => {
    expect(computeSplit({ total: '100.00', mode: 'equal', members })).toEqual({ ok: true, shares: { a: '33.34', b: '33.33', c: '33.33' } });
    expect(computeSplit({ total: '0,02', mode: 'equal', members })).toEqual({ ok: true, shares: { a: '0.01', b: '0.01', c: '0.00' } });
  });
  it('igual só entre selecionados (2 de 3)', () => {
    expect(computeSplit({ total: '300.00', mode: 'selected', members, selected: ['a', 'c'] })).toEqual({ ok: true, shares: { a: '150.00', b: '0.00', c: '150.00' } });
    expect(computeSplit({ total: '300.00', mode: 'selected', members, selected: [] }).ok).toBe(false);
  });
  it('valores exatos: soma precisa fechar, com quanto falta', () => {
    expect(computeSplit({ total: '300.00', mode: 'exact', members, exact: { a: '100', b: '150,00', c: '50' } })).toEqual({ ok: true, shares: { a: '100.00', b: '150.00', c: '50.00' } });
    const r = computeSplit({ total: '300.00', mode: 'exact', members, exact: { a: '100', b: '150', c: '20' } });
    expect(r).toEqual({ ok: false, error: 'Falta distribuir R$ 30,00.', remaining: '30.00' });
    expect(computeSplit({ total: '300.00', mode: 'exact', members, exact: { a: '200', b: '150', c: '0' } }).ok).toBe(false);
  });
  it('percentual com soma 100% e arredondamento pelos maiores restos', () => {
    expect(computeSplit({ total: '100.00', mode: 'percent', members, percent: { a: '33.33', b: '33.33', c: '33.34' } })).toEqual({ ok: true, shares: { a: '33.33', b: '33.33', c: '33.34' } });
    expect(computeSplit({ total: '10.00', mode: 'percent', members, percent: { a: '50', b: '50', c: '0' } })).toEqual({ ok: true, shares: { a: '5.00', b: '5.00', c: '0.00' } });
    expect(computeSplit({ total: '10.00', mode: 'percent', members, percent: { a: '50', b: '40', c: '0' } }).ok).toBe(false);
  });
  it('saldo líquido por pessoa e acertos confirmados', () => {
    const bal = memberBalances(['a', 'b'], [
      { payer: 'a', total: '300.00', shares: { a: '150.00', b: '150.00' } },
      { payer: 'b', total: '100.00', shares: { a: '50.00', b: '50.00' } },
    ], [{ from: 'b', to: 'a', amount: '60.00', status: 'confirmed' }, { from: 'b', to: 'a', amount: '40.00', status: 'pending' }]);
    expect(bal).toEqual({ a: 4000n, b: -4000n });
  });
});
