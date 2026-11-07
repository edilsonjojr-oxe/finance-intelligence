import { describe, expect, it } from 'vitest';
import { buildMemory, categoryList, merchantKey, suggestCategory } from '../src/lib/categorize';
import { defaultCardName, extractCardMeta } from '../src/lib/document-extraction';
import { forecast, nextDueDate } from '../src/lib/finance';
import type { Account } from '../src/lib/types';

describe('Categorização automática', () => {
  it('sugere por regras comuns', () => {
    expect(suggestCategory('IFOOD *RESTAURANTE SABOR')).toBe('Alimentação');
    expect(suggestCategory('NETFLIX.COM')).toBe('Assinaturas');
    expect(suggestCategory('POSTO IPIRANGA CENTRO')).toBe('Combustível');
    expect(suggestCategory('DROGARIA SAO PAULO')).toBe('Farmácia');
    expect(suggestCategory('UBER *TRIP')).toBe('Transporte');
    expect(suggestCategory('ZAFFARI BOURBON')).toBe('Supermercado');
    expect(suggestCategory('MERCADOLIVRE*VENDEDOR')).toBe('Compras');
    expect(suggestCategory('LOJA SEM PISTA 123')).toBe('Sem categoria');
    expect(suggestCategory('SALARIO EMPRESA X', 'income')).toBe('Salário');
  });
  it('aprende com a escolha do usuário e ela vence a regra', () => {
    const memory = buildMemory([
      { description: 'IFOOD *MERCADO DA ESQUINA', category: 'Supermercado', date: '2026-10-01' },
      { description: 'Loja Sem Pista 999', category: 'Presentes e doações', date: '2026-10-02' },
    ]);
    expect(suggestCategory('IFOOD *MERCADO DA ESQUINA PARC 02/03', 'expense', memory)).toBe('Supermercado');
    expect(suggestCategory('LOJA SEM PISTA 123', 'expense', memory)).toBe('Presentes e doações');
  });
  it('chave do estabelecimento ignora números, parcelas e acentos', () => {
    expect(merchantKey('Farmácia São João 123 PARC 01/10')).toBe(merchantKey('FARMACIA SAO JOAO 456'));
  });
  it('lista junta prontas, personalizadas e usadas sem repetir', () => {
    const list = categoryList(['Escola', 'alimentação'], ['Escola', 'Transferência interna']);
    expect(list[0]).toBe('Sem categoria');
    expect(list.filter((c) => c.toLowerCase() === 'alimentação')).toHaveLength(1);
    expect(list).toContain('Escola');
    expect(list).not.toContain('Transferência interna');
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
