import { describe,it,expect } from 'vitest';
import { extractEntries,extractContract } from '../src/lib/document-extraction';
import { intakeSchema,financialDescription,obligationStage } from '../src/lib/intake';
import { forecast } from '../src/lib/finance';
import type { Obligation } from '../src/lib/types';

describe('Extração conservadora e minimização',()=>{
  it('extrai cobrança rotulada sem salvar o texto integral',()=>{
    const [row]=extractEntries('Descrição: Internet\nVencimento: 12/11/2026\nValor: R$ 129,90');
    expect(row).toMatchObject({description:'Internet',date:'2026-11-12',amount:'129.90',event_type:'charged'});
    expect(row).not.toHaveProperty('text');
  });
  it('não inventa ano nem resolve valores ambíguos',()=>{
    expect(extractEntries('12/11 Compra 123,45')[0].date).toBe('');
    expect(extractEntries('12/11/2026 Compra 10,00 Total 20,00')[0].amount).toBe('');
    expect(extractEntries('31/02/2026 Compra 10,00')[0].date).toBe('');
  });
  it('extrai linhas de extrato e distingue entrada',()=>{
    const rows=extractEntries('01/11/2026 Mercado -25,50\n02/11/2026 Salário 2.000,01','paid');
    expect(rows.map(r=>[r.amount,r.kind,r.event_type])).toEqual([['25.50','expense','paid'],['2000.01','income','paid']]);
  });
  it('mantém hipótese como estimativa, inclusive vencida',()=>{
    expect(extractEntries('Talvez eu compre em 12/11/2026 Mesa 250,00')[0].event_type).toBe('estimated');
    expect(obligationStage({status:'open',stage:'estimated',due_date:'2020-01-01'},'2026-11-07')).toBe('Estimado');
  });
  it('extrai condições contratuais, sem inventar juros faltantes',()=>{
    expect(extractContract('Título: Curso\nInstituição: Escola\nValor mensal: R$ 100,00\nValor contratado: R$ 600,00\nInício: 01/11/2026\nParcelas: 6\nDia de vencimento: 10\nJuros: 1,5% ao mês\nCET: 22,4%\nMulta: 2%')).toMatchObject({title:'Curso',counterparty:'Escola',amount:'100.00',total_amount:'600.00',months:'6',due_day:'10',interest_rate:'1.5',cet:'22.4',penalty_note:'2%'});
    expect(extractContract('Título: Internet').interest_rate).toBe('');
  });
  it('remove identificadores dispensáveis e recusa conteúdo bruto na API',()=>{
    expect(financialDescription('Cartão 4111 1111 1111 1111 CPF 123.456.789-01')).not.toMatch(/4111|123\.456/);
    expect(intakeSchema.safeParse({source_type:'document',source_hash:'a'.repeat(64),text:'original',items:[]}).success).toBe(false);
  });
  it('exclui estimativas do cenário base e permite cenário explícito',()=>{
    const o={id:'1',status:'open',stage:'estimated',amount:'10.00',kind:'expense',due_date:'2026-11-07'} as Obligation;
    expect(forecast([], [o],'2026-11-07',1)[0].balance).toBe('0.00');
    expect(forecast([], [o],'2026-11-07',1,true)[0].balance).toBe('-10.00');
  });
});
