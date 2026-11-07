import { describe, expect, it } from 'vitest';
import { buildMemory, categoryGroup, categoryList, cleanCategory, merchantKey, suggestCategory } from '../src/lib/categorize';
import { defaultCardName, extractCardMeta } from '../src/lib/document-extraction';
import { categoryBreakdown, forecast, nextDueDate } from '../src/lib/finance';
import type { Account, Movement } from '../src/lib/types';

describe('Categorização automática', () => {
  it('sugere grupo e subcategoria por regras comuns', () => {
    expect(suggestCategory('IFOOD *RESTAURANTE SABOR')).toBe('Alimentação / Delivery');
    expect(suggestCategory('IFD*PIZZARIA DO ZE')).toBe('Alimentação / Delivery');
    expect(suggestCategory('99FOOD *LANCHES')).toBe('Alimentação / Delivery');
    expect(suggestCategory('DL*99FOOD')).toBe('Alimentação / Delivery');
    expect(suggestCategory('UBER *EATS PENDING')).toBe('Alimentação / Delivery');
    expect(suggestCategory('UBER *TRIP')).toBe('Transporte / Apps de corrida');
    expect(suggestCategory('99APP *CORRIDA')).toBe('Transporte / Apps de corrida');
    expect(suggestCategory('NETFLIX.COM')).toBe('Assinaturas / Streaming');
    expect(suggestCategory('POSTO IPIRANGA CENTRO')).toBe('Transporte / Combustível');
    expect(suggestCategory('DROGARIA SAO PAULO')).toBe('Saúde / Farmácia');
    expect(suggestCategory('ZAFFARI BOURBON')).toBe('Alimentação / Mercado');
    expect(suggestCategory('PADARIA NOVA')).toBe('Alimentação / Padaria e café');
    expect(suggestCategory('CAMICADO SHOPPING')).toBe('Casa / Cama, mesa e banho');
    expect(suggestCategory('MERCADOLIVRE*VENDEDOR')).toBe('Compras / Online');
    expect(suggestCategory('LOJA SEM PISTA 123')).toBe('Sem categoria');
    expect(suggestCategory('SALARIO EMPRESA X', 'income')).toBe('Receitas / Salário');
    expect(suggestCategory('ESTORNO LOJA', 'income')).toBe('Receitas / Reembolsos e estornos');
  });
  it('aprende com a escolha do usuário e ela vence a regra', () => {
    const memory = buildMemory([
      { description: 'IFOOD *MERCADO DA ESQUINA', category: 'Alimentação / Mercado', date: '2026-10-01' },
      { description: 'Loja Sem Pista 999', category: 'Compras / Presentes', date: '2026-10-02' },
      { description: 'Compra dividida', category: 'Dividido', date: '2026-10-03' },
    ]);
    expect(suggestCategory('IFOOD *MERCADO DA ESQUINA PARC 02/03', 'expense', memory)).toBe('Alimentação / Mercado');
    expect(suggestCategory('LOJA SEM PISTA 123', 'expense', memory)).toBe('Compras / Presentes');
    expect(suggestCategory('COMPRA DIVIDIDA', 'expense', memory)).toBe('Sem categoria');
  });
  it('chave do estabelecimento ignora números, parcelas e acentos', () => {
    expect(merchantKey('Farmácia São João 123 PARC 01/10')).toBe(merchantKey('FARMACIA SAO JOAO 456'));
  });
  it('lista junta prontas, personalizadas e usadas sem repetir', () => {
    const list = categoryList(['Filhos / Escola', 'alimentação / mercado'], ['Filhos / Escola', 'Transferência interna', 'Dividido']);
    expect(list[0]).toBe('Sem categoria');
    expect(list.filter((c) => c.toLowerCase() === 'alimentação / mercado')).toHaveLength(1);
    expect(list).toContain('Filhos / Escola');
    expect(list).toContain('Alimentação / Delivery');
    expect(list).not.toContain('Transferência interna');
    expect(list).not.toContain('Dividido');
  });
  it('normaliza o separador digitado', () => {
    expect(cleanCategory('Casa/Limpeza')).toBe('Casa / Limpeza');
    expect(cleanCategory(' Casa >  Cama, mesa e banho ')).toBe('Casa / Cama, mesa e banho');
    expect(cleanCategory('Outros')).toBe('Outros');
    expect(categoryGroup('Alimentação / Mercado')).toBe('Alimentação');
  });
});

describe('Despesas por grupo e subcategoria', () => {
  const tx = (id: string, amount: string, category: string, extra: Partial<Movement> = {}) =>
    ({ id, account_id: 'a', destination_account_id: null, kind: 'expense', amount, date: '2026-11-03', competence: '2026-11-03', description: id, category, status: 'posted', source: 'manual', ...extra }) as Movement;
  it('usa as partes de lançamentos divididos e ignora estornados e transferências', () => {
    const rows = categoryBreakdown(
      [
        tx('mercado', '300.00', 'Dividido'),
        tx('ifood', '50.00', 'Alimentação / Delivery'),
        tx('estornado', '999.00', 'Alimentação / Delivery', { status: 'reversed' }),
        tx('transf', '500.00', 'Transferência interna', { kind: 'transfer' }),
        tx('outro-mes', '10.00', 'Casa / Limpeza', { date: '2026-10-30' }),
      ],
      [
        { transaction_id: 'mercado', category: 'Alimentação / Mercado', amount: '240.00', description: '' },
        { transaction_id: 'mercado', category: 'Casa / Cama, mesa e banho', amount: '60.00', description: 'travesseiro' },
      ],
      '2026-11',
    );
    expect(rows.map((r) => [r.group, r.total.toString()])).toEqual([['Alimentação', '29000'], ['Casa', '6000']]);
    expect(rows[0].subs.map((s) => [s.name, s.total.toString()])).toEqual([['Mercado', '24000'], ['Delivery', '5000']]);
  });
});

describe('Identificação do cartão na fatura', () => {
  const fatura = `OUROCARD BANCO DO BRASIL - FATURA
MASTERCARD BLACK
Titular: MARIA REGIANE DA SILVA
Cartão final 4821
Vencimento: 10/01/2027
Total desta fatura R$ 1.876,40`;
  it('extrai banco, bandeira, titular, final, vencimento e total', () => {
    const meta = extractCardMeta(fatura);
    expect(meta).toEqual({ issuer: 'Banco do Brasil', brand: 'Mastercard', holder: 'Maria Regiane Da Silva', last4: '4821', due_date: '2027-01-10', total: '1876.40', due_day: '10' });
    expect(defaultCardName(meta)).toBe('Banco do Brasil Mastercard Maria •4821');
  });
  it('reconhece o final mascarado e deixa vazio o que não encontrar', () => {
    const meta = extractCardMeta('Fatura Nubank\n**** **** **** 1234\nVencimento 05/02/2027');
    expect(meta.issuer).toBe('Nubank');
    expect(meta.last4).toBe('1234');
    expect(meta.brand).toBe('');
    expect(meta.holder).toBe('');
  });
});

describe('Cartão na projeção', () => {
  it('calcula o próximo vencimento, inclusive fim de mês', () => {
    expect(nextDueDate('2026-11-07', 10)).toBe('2026-11-10');
    expect(nextDueDate('2026-11-12', 10)).toBe('2026-12-10');
    expect(nextDueDate('2026-12-20', 5)).toBe('2027-01-05');
    expect(nextDueDate('2027-02-01', 31)).toBe('2027-02-28');
  });
  it('saldo disponível não inclui a dívida do cartão; a fatura sai no vencimento', () => {
    const accounts = [
      { id: 'c', name: 'Conta', institution: '', type: 'checking', opening_balance: '0', opening_date: '2026-01-01', balance: '3000.00' },
      { id: 'k', name: 'Cartão', institution: '', type: 'credit_card', opening_balance: '0', opening_date: '2026-01-01', balance: '-1200.00', due_day: 10 },
    ] as Account[];
    const points = forecast(accounts, [], '2026-11-07', 5);
    expect(points[0].balance).toBe('3000.00');
    expect(points.find((p) => p.date === '2026-11-10')).toMatchObject({ expense: '1200.00', balance: '1800.00' });
  });
});
