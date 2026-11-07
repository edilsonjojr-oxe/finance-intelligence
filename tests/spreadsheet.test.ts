import { describe, expect, it } from 'vitest';
import { analyzeWorkbook, cellMoney, parseScheduleText, sheetMonth, type Cell } from '../src/lib/spreadsheet-import';
import { suggestCategory } from '../src/lib/categorize';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('Leitura de planilha pessoal', () => {
  it('reconhece mês/ano pelo nome da aba', () => {
    expect(sheetMonth('Mai25')).toEqual({ month: 5, year: 2025 });
    expect(sheetMonth('Outubro')).toEqual({ month: 10, year: undefined });
    expect(sheetMonth('abr')).toEqual({ month: 4, year: undefined });
    expect(sheetMonth('Acordos')).toBeNull();
  });
  it('converte valores em número ou texto brasileiro', () => {
    expect(cellMoney(134.14000000000001)).toBe('134.14');
    expect(cellMoney('R$ 1.567,18')).toBe('1567.18');
    expect(cellMoney('24X 178,85')).toBe('24.00');
    expect(cellMoney(null)).toBe('');
    expect(cellMoney(-5)).toBe('');
  });
  it('lê abas mensais (data, só o dia ou sem data), status e categorias da planilha; junta repetidos', () => {
    const header: Cell[] = ['Descrição', 'Valor', 'Vencimento', 'Pagamento', 'Status', 'Observação'];
    const a = analyzeWorkbook([
      { name: 'Jul25', rows: [header, ['Aluguel', 592.5, d('2025-07-05'), null, 'PAGO', null], ['Netflix', 22.45, d('2025-07-05'), null, 'PENDENTE', null], ['Acordo X', null, d('2025-07-12'), null, 'PENDENTE', null]] },
      { name: 'Out25', rows: [header, ['Internet/Celular', 236.11, 10, null, 'PENDENTE', null]] },
      { name: 'Jun25', rows: [header, ['Casa RTM', 134.14, null, null, 'PAGO', null]] },
      { name: 'Jul', rows: [header, ['Aluguel', 592.5, d('2025-07-05'), null, 'PAGO', null]] },
      { name: 'Novembro', rows: [['OUTUBRO'], ['Descrição', 'Valor', 'Vencimento', 'Pagamento', 'Status', 'Categoria Nivel 1', 'Categoria Nivel 2'], ['Aniversariantes', 20, d('2024-10-05'), d('2024-10-05'), 'Pago', 'VARIÁVEL', 'PRESENTES']] },
    ], '2026-11-07');
    expect(a.duplicates).toBe(1);
    const by = (desc: string) => a.monthly.find((m) => m.description === desc)!;
    expect(by('Aluguel')).toMatchObject({ amount: '592.50', date: '2025-07-05', paid: true });
    expect(by('Netflix').paid).toBe(false);
    expect(by('Acordo X').amount).toBe('');
    expect(by('Internet/Celular')).toMatchObject({ date: '2025-10-10', dateGuessed: false });
    expect(by('Casa RTM')).toMatchObject({ date: '2025-06-01', dateGuessed: true });
    expect(by('Aniversariantes').categoryHint).toBe('VARIÁVEL / PRESENTES');
  });
  it('encontra blocos de parcelas com título e status, e listas de gastos fixos', () => {
    const a = analyzeWorkbook([
      { name: 'Emprestimo', rows: [
        [null, 'EMPRESTIMO 2', '3X 178,85', 'STATUS', null, 'ASSINATURAS MENSAIS', 100.9, 'Forma Pagamento'],
        [null, d('2026-04-01'), 178.85, 'PAGO', null, 'CANVA PRO', 35, 'Cartão de Crédito'],
        [null, d('2026-05-01'), 178.85, null, null, 'CHATGPT', 65.9, 'Cartão de Crédito'],
        [null, d('2026-06-01'), 178.85, null, null, null, null, null],
      ] },
      { name: 'Acordos', rows: [
        ['Dividas Banco'], ['QTD', 'PARCELA'], [2, 104.72], [null, 'Vencimento', 'Valor', 'Status'],
        [1, d('2022-09-16'), 104.72, 'PAGO'], [2, d('2022-10-16'), 104.72, 'PENDENTE'],
      ] },
    ], '2026-11-07');
    expect(a.schedules.map((s) => [s.title, s.installments.length, s.installments.filter((p) => p.paid).length])).toEqual([
      ['EMPRESTIMO 2', 3, 1],
      ['Dividas Banco', 2, 1],
    ]);
    expect(a.recurring.map((r) => [r.description, r.amount, r.payment])).toEqual([
      ['CANVA PRO', '35.00', 'Cartão de Crédito'],
      ['CHATGPT', '65.90', 'Cartão de Crédito'],
    ]);
  });
  it('categorias vindas da planilha: fatura, empréstimo e nome de grupo', () => {
    expect(suggestCategory('Cartão Santander')).toBe('Dívidas e empréstimos / Fatura de cartão');
    expect(suggestCategory('CARTÃO')).toBe('Dívidas e empréstimos / Fatura de cartão');
    expect(suggestCategory('EMPRESTIMO EM FOLHA 4')).toBe('Dívidas e empréstimos / Parcelas de empréstimo');
    expect(suggestCategory('Acordo Unirriter')).toBe('Dívidas e empréstimos / Acordos');
    expect(suggestCategory('ASSINATURAS')).toBe('Assinaturas');
    expect(suggestCategory('EDUCAÇÃO')).toBe('Educação');
    expect(suggestCategory('Natura cosméticos')).toBe('Cuidados pessoais / Beleza');
  });
  it('lê parcelas de um texto/print', () => {
    const rows = parseScheduleText('Parcela 1 10/12/2026 R$ 250,00 pago\nParcela 2 10/01/2027 R$ 250,00\nTotal 500,00\n15/02 R$ 1.250,10', '2026-11-07');
    expect(rows).toEqual([
      { date: '2026-12-10', amount: '250.00', paid: true },
      { date: '2027-01-10', amount: '250.00', paid: false },
      { date: '2026-02-15', amount: '1250.10', paid: false },
    ]);
  });
});
