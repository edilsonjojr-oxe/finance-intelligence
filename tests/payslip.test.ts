import { describe, expect, it } from 'vitest';
import { isPayslip, parsePayslip, payslipItems } from '../src/lib/payslip';
import { extractEntries } from '../src/lib/document-extraction';
import { cents, decimal } from '../src/lib/money';

// Contracheques fictícios (nomes, valores e empresa inventados).
const layoutColunas = `Demonstrativo de pagamento de Salário - 03/2026
Empresa:   EMPRESA EXEMPLO LTDA   CNPJ:   00.000.000/0001-00
Banco:   BANCO EXEMPLO   Agência:   0001
Número da conta:   123   Data de pagamento:   31/03/2026
Descrição   Referência   Proventos   Descontos   Informativas
Salario Mensal   220.00   R$ 5.000,00   -   -
Horas Extras 50%   10.00   R$ 340,90   -   -
Desc.Adto Salarial   0.00   -   -R$ 2.000,00   -
INSS Mensal   14.00   -   -R$ 600,00   -
Imposto de Renda Mensal   27.50   -   -R$ 420,15   -
Empréstimo Consignado   12.00   -   -R$ 310,00   -
Plano de Saúde   0.00   -   -R$ 89,90   -
FGTS   8.00   -   -   R$ 427,27
Totais   R$ 5.340,90   -R$ 3.420,05
Valor líquido a receber   R$ 1.920,85`;

const layoutSemRS = `RECIBO DE PAGAMENTO DE SALARIO   Referência: 04/2026
Cód   Descrição   Ref   Vencimentos   Descontos
001   SALARIO BASE   30,00   3.000,00
250   INSS   9,00   270,00
260   VALE TRANSPORTE   6,00   180,00
Total de Vencimentos 3.000,00   Total de Descontos 450,00
Líquido a Receber R$ 2.550,00
Crédito em 05/05/2026`;

describe('contracheque', () => {
  it('lê colunas de proventos/descontos e confere com o líquido', () => {
    const p = parsePayslip(layoutColunas)!;
    expect(isPayslip(layoutColunas)).toBe(true);
    expect([p.competence, p.paymentDate, decimal(p.earnings), decimal(p.deductions), p.consistent]).toEqual(['2026-03', '2026-03-31', '5340.90', '3420.05', true]);
    expect(p.lines.find((l) => /FGTS/.test(l.description))).toBeUndefined(); // informativa ignorada
  });
  it('conta recebe só o líquido no dia; adiantamento entra na data dele; receita do mês = bruto', () => {
    const items = payslipItems(parsePayslip(layoutColunas)!, '2026-04-10');
    const effect = (d: string) => decimal(items.filter((i) => i.date === d).reduce((s, i) => s + (i.kind === 'income' ? cents(i.amount) : -cents(i.amount)), 0n));
    expect(effect('2026-03-31')).toBe('1920.85');
    expect(effect('2026-03-15')).toBe('2000.00');
    const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + cents(i.amount), 0n);
    expect(decimal(income)).toBe('5340.90');
    expect(items.every((i) => i.event_type === 'paid')).toBe(true);
    expect(items.find((i) => /INSS/.test(i.description))!.category).toBe('Impostos e taxas / Impostos');
    expect(items.find((i) => /Consignado/.test(i.description))!.category).toBe('Dívidas e empréstimos / Parcelas de empréstimo');
  });
  it('layout sem "R$" usa palavras-chave e a data de crédito', () => {
    const p = parsePayslip(layoutSemRS)!;
    expect([decimal(p.earnings), decimal(p.deductions), p.consistent, p.paymentDate]).toEqual(['3000.00', '450.00', true, '2026-05-05']);
  });
  it('extractEntries reconhece o contracheque antes de outros formatos', () => {
    const rows = extractEntries(layoutColunas, 'charged');
    expect(rows.length).toBe(7);
    expect(rows.every((r) => r.key.startsWith('payslip-'))).toBe(true);
  });
});
