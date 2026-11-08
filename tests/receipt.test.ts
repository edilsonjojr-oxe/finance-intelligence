import { describe, expect, it } from 'vitest';
import { parseReceipt, productCategory, productMemory, receiptParts } from '../src/lib/receipt';
import { cents } from '../src/lib/money';

const cupom = `SUPERMERCADO SINTETICO LTDA
CNPJ: 00.000.000/0001-00
Rua Exemplo, 100
DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRONICA
Código Descrição Qtde UN Vl Unit Vl Total
001 7891000100103 ARROZ TIPO 1 5KG 1 UN X 25,90 25,90
002 7891000200201 FEIJAO PRETO 1KG 2 UN X 8,49 16,98
003 7891000300301 DETERGENTE NEUTRO 500ML 3 UN X 2,99 8,97
004 7891000400401 TRAVESSEIRO FIBRA 1 UN X 39,90 39,90
005 7891000500501 SHAMPOO 350ML 1 UN X 13,25 13,25
006 7891000600601 CERVEJA LATA 350ML 6 UN X 3,50 21,00
Qtd. total de itens 14
Valor total R$ 126,00
Desconto R$ 6,00
Valor a pagar R$ 120,00
Forma de pagamento Cartão de Crédito 120,00
Emissão 05/11/2026 18:32:10`;

describe('Nota de mercado', () => {
  it('lê loja, data, total, desconto e itens com categoria por produto', () => {
    const r = parseReceipt(cupom);
    expect([r.store, r.date, r.total, r.discount]).toEqual(['SUPERMERCADO SINTETICO LTDA', '2026-11-05', '120.00', '6.00']);
    expect(r.items.map((i) => [i.description, i.amount, i.category])).toEqual([
      ['ARROZ TIPO 1', '25.90', 'Alimentação / Mercado'],
      ['FEIJAO PRETO', '16.98', 'Alimentação / Mercado'],
      ['DETERGENTE NEUTRO', '8.97', 'Casa / Limpeza'],
      ['TRAVESSEIRO FIBRA', '39.90', 'Casa / Cama, mesa e banho'],
      ['SHAMPOO', '13.25', 'Cuidados pessoais / Higiene'],
      ['CERVEJA LATA', '21.00', 'Alimentação / Bebidas'],
    ]);
  });
  it('reparte o desconto e agrupa por categoria com soma igual ao valor pago', () => {
    const r = parseReceipt(cupom);
    const parts = receiptParts(r.items, '120.00');
    expect(parts.reduce((n, p) => n + cents(p.amount), 0n)).toBe(12000n);
    const mercado = parts.find((p) => p.category === 'Alimentação / Mercado')!;
    expect(mercado.description).toBe('ARROZ TIPO 1, FEIJAO PRETO');
    expect(parts.find((p) => p.category === 'Casa / Cama, mesa e banho')!.amount).toBe('38.00');
  });
  it('aprende a categoria de produtos pelas divisões anteriores', () => {
    const memory = productMemory([{ category: 'Pets / Ração e petshop', description: 'PETISCO DOGUITO, OSSO NATURAL' }]);
    expect(productCategory('OSSO NATURAL', memory)).toBe('Pets / Ração e petshop');
    expect(productCategory('OSSO NATURAL')).toBe('Alimentação / Mercado');
  });
});
