import { describe, expect, it } from 'vitest';
import { extractEntries, invoiceReference } from '../src/lib/document-extraction';

const fatura = `BANCO SINTÉTICO - FATURA DO CARTÃO
Titular: PESSOA SINTÉTICA
Vencimento: 10/01/2027 Total a pagar R$ 1.876,40
Limite total R$ 5.000,00
Pagamento mínimo R$ 281,46
DATA DESCRIÇÃO VALOR
12/12 PAGAMENTO EFETUADO -1.200,00
28/12 SUPERMERCADO SINTETICO 342,15
02/01 FARMACIA EXEMPLO 58,90
15/11 LOJA ELETRO PARC 03/10 210,00
05/01 ESTORNO LOJA EXEMPLO -45,00
30/12 APP STREAMING US$ 9,99 54,35
Total desta fatura 1.876,40`;

describe('Fatura de cartão', () => {
  it('lê itens com data sem ano, inferindo o ano pelo vencimento', () => {
    expect(invoiceReference(fatura)).toEqual({ year: 2027, month: 1 });
    const rows = extractEntries(fatura);
    expect(rows.map((r) => [r.date, r.amount, r.kind])).toEqual([
      ['2026-12-28', '342.15', 'expense'],
      ['2027-01-02', '58.90', 'expense'],
      ['2026-11-15', '210.00', 'expense'],
      ['2027-01-05', '45.00', 'income'],
      ['2026-12-30', '54.35', 'expense'],
    ]);
  });
  it('não lê o vencimento, o total nem o pagamento anterior como compra', () => {
    const descriptions = extractEntries(fatura).map((r) => r.description.toLowerCase()).join(' | ');
    expect(descriptions).not.toMatch(/pagamento|total|vencimento|limite/);
    expect(descriptions).toContain('parc 03/10');
  });
  it('aceita mês por extenso e datas completas no início da linha', () => {
    const texto = `Fatura cartão\nData de vencimento 05/03/2026\n14 FEV Padaria Sintética 23,40\n20/02/2026 Posto Exemplo 150,00`;
    expect(extractEntries(texto).map((r) => [r.date, r.amount])).toEqual([
      ['2026-02-14', '23.40'],
      ['2026-02-20', '150.00'],
    ]);
  });
  it('documento comum continua no leitor anterior', () => {
    const [row] = extractEntries('Descrição: Internet\nVencimento: 12/11/2026\nValor: R$ 129,90');
    expect(row.amount).toBe('129.90');
  });
});
