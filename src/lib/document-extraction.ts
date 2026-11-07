import { financialDescription, type ExtractedItem } from './intake';
import { validDate } from './money';
export function normalizedDate(value:string) {
  const s=value.trim();const d=/^\d{2}\/\d{2}\/\d{4}$/.test(s)?s.split('/').reverse().join('-'):s;
  return validDate(d)?d:'';
}
const moneyPattern=/-?\s*(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\b/g;
const datePattern=/\b(?:\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/;
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const monetary=(s:string)=>s.replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.').replace(/^-/,'');
function lineValue(text:string,labels:string[]) {
  return text.split(/\r?\n/).find(line=>labels.some(label=>normalize(line).startsWith(label)))?.split(/[:=]/).slice(1).join(':').trim()||'';
}
export function extractEntries(text:string,event:'paid'|'charged'|'predicted'='charged'):ExtractedItem[] {
  const lines=text.split(/\r?\n/).filter(Boolean);
  const rows:ExtractedItem[]=[];
  // Somente linhas com data completa e valor em centavos. Nenhum ano/valor é inventado.
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];const d=line.match(datePattern)?.[0];const amounts=[...line.matchAll(moneyPattern)];
    if(!d||amounts.length!==1) continue;
    const amount=amounts[0][0];
    const description=financialDescription(line.replace(d,'').replace(amount,'').replace(/^[\s;|:-]+|[\s;|:-]+$/g,''));
    rows.push({key:`line-${i+1}`,date:normalizedDate(d),amount:monetary(amount),description,category:'Sem categoria',
      kind:/receb|credito|salario|entrada/i.test(normalize(line))&&!amount.includes('-')?'income':'expense',
      event_type:/talvez|pretendo|hipotetic|se eu/i.test(normalize(text))?'estimated':event});
  }
  if(rows.length) return rows.slice(0,300);
  const dateLine=lineValue(text,['vencimento','data de vencimento','data do pagamento','data de pagamento','data']);
  const amountLine=lineValue(text,['valor pago','valor da cobranca','valor a pagar','total a pagar','valor total','valor','total']);
  const amount=amountLine.match(moneyPattern)?.[0];
  return [{key:'summary',description:financialDescription(lineValue(text,['descricao','servico','beneficiario','estabelecimento'])),
    date:normalizedDate(dateLine.match(datePattern)?.[0]||''),amount:amount?monetary(amount):'',category:'Sem categoria',kind:'expense',
    event_type:/talvez|pretendo|hipotetic|se eu/i.test(normalize(text))?'estimated':event}];
}
export function extractContract(text:string):Record<string,string> {
  const money=(labels:string[])=>{const v=lineValue(text,labels).match(moneyPattern)?.[0];return v?monetary(v):'';};
  const date=(labels:string[])=>normalizedDate(lineValue(text,labels).match(datePattern)?.[0]||'');
  const rate=(labels:string[])=>lineValue(text,labels).match(/\d+(?:[.,]\d+)?(?=\s*%)/)?.[0].replace(',','.')||'';
  return {
    title:financialDescription(lineValue(text,['titulo','objeto','tipo de contrato'])),
    counterparty:financialDescription(lineValue(text,['instituicao','contratada','credor','locador','fornecedor'])),
    amount:money(['valor da parcela','valor mensal','mensalidade','aluguel mensal']),
    total_amount:money(['valor contratado','valor total']),
    start_date:date(['inicio da vigencia','data de inicio','vigencia inicial','inicio']),
    end_date:date(['fim da vigencia','vigencia final','termino']),renewal_date:date(['renovacao','data de renovacao']),
    months:lineValue(text,['quantidade de parcelas','numero de parcelas','parcelas']).match(/\d+/)?.[0]||'',
    due_day:lineValue(text,['dia de vencimento','vencimento mensal']).match(/\d+/)?.[0]||'',
    interest_rate:rate(['juros','taxa de juros']),cet:rate(['cet']),
    rate_period:/ao ano|anual|a\.a\./i.test(lineValue(text,['juros','taxa de juros']))?'annual':/ao mes|mensal|a\.m\./i.test(normalize(lineValue(text,['juros','taxa de juros'])))?'monthly':'',
    cet_period:/ao mes|mensal|a\.m\./i.test(normalize(lineValue(text,['cet'])))?'monthly':/ao ano|anual|a\.a\./i.test(lineValue(text,['cet']))?'annual':'',
    adjustment_note:lineValue(text,['reajuste','condicoes de reajuste']).slice(0,500),
    penalty_note:lineValue(text,['multa','multas','encargos']).slice(0,500),
    contract_type:'service',category:'Sem categoria',
  };
}
