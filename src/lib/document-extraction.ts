import { financialDescription, type ExtractedItem } from './intake';
import { validDate } from './money';
import { parsePayslip, payslipItems } from './payslip';
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
  // Contracheque: proventos e descontos viram lançamentos realizados na data do pagamento.
  const payslip=parsePayslip(text);
  if(payslip) return payslipItems(payslip,new Date().toISOString().slice(0,10));
  // Fatura de cartão primeiro: a linha do vencimento tem data e valor e seria lida como um item.
  const invoice=extractCardInvoice(text,event);
  if(invoice.length) return invoice;
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
const monthNumber:Record<string,number>={jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
// Início de linha "15/10", "15.10", "15 OUT" ou "15/out" — sem ano (o ano completo já foi tratado acima).
const shortDatePattern=/^\s*(\d{1,2})\s*[/.\s-]\s*(\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?![/.]\d)(?=\s)/i;
/** Mês/ano de referência da fatura: data de vencimento (ou a primeira data completa do texto). */
export function invoiceReference(text:string) {
  const flat=normalize(text);
  const due=flat.match(/vencimento[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/)?.[1]||flat.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];
  const iso=due?normalizedDate(due):'';
  return iso?{year:Number(iso.slice(0,4)),month:Number(iso.slice(5,7))}:null;
}
/**
 * Itens de fatura de cartão. Exige texto com cara de fatura e data de vencimento para inferir o
 * ano (compra em mês posterior ao vencimento pertence ao ano anterior). O pagamento da fatura
 * anterior, saldos e totais são ignorados para não contar o mesmo dinheiro duas vezes.
 */
export function extractCardInvoice(text:string,event:'paid'|'charged'|'predicted'='charged'):ExtractedItem[] {
  const flat=normalize(text);
  if(!/fatura|cartao|limite (?:total|disponivel)|total (?:da fatura|a pagar)/.test(flat))return [];
  const ref=invoiceReference(text);
  if(!ref)return [];
  const rows:ExtractedItem[]=[];
  const lines=text.split(/\r?\n/);
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];const plain=normalize(line);
    const full=line.match(/^\s*(\d{2}\/\d{2}\/\d{4})(?=\s)/);
    const d=full||line.match(shortDatePattern);if(!d)continue;
    if(/pagamento (?:efetuado|recebido|de fatura|da fatura|minimo)|pgto|saldo (?:anterior|em aberto)|total|vencimento|limite|melhor dia/.test(plain))continue;
    const amounts=[...line.matchAll(moneyPattern)];if(!amounts.length)continue;
    let date='';
    if(full) date=normalizedDate(full[1]);
    else {
      const day=Number(d[1]),month=/^\d+$/.test(d[2])?Number(d[2]):monthNumber[d[2].slice(0,3).toLowerCase()];
      if(!month||month>12||day<1||day>31)continue;
      const year=month>ref.month?ref.year-1:ref.year;
      date=normalizedDate(`${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`);
    }
    if(!date)continue;
    // Com dólar e real na mesma linha, o valor em reais é o último.
    const amount=amounts[amounts.length-1][0];
    const credit=amount.trim().startsWith('-')||/-\s*$/.test(line.trim())||/estorno|credito|reembolso|cashback/.test(plain);
    const description=financialDescription(line.slice(d[0].length)
      .replace(moneyPattern,'').replace(/\b(?:R\$|US\$|USD|BRL)\b/gi,'').replace(/^[\s;|:-]+|[\s;|:-]+$/g,'').replace(/\s{2,}/g,' '));
    rows.push({key:`card-${i+1}`,date,amount:monetary(amount),description,category:'Sem categoria',
      kind:credit?'income':'expense',event_type:event});
  }
  return rows.slice(0,300);
}
export type CardMeta={issuer:string;brand:string;holder:string;last4:string;due_date:string;total:string;due_day:string};
const issuers:[string,RegExp][]=[
  ['Banco do Brasil',/banco do brasil|ourocard|\bbb\b cart|\bbb\b visa|\bbb\b master/],['Itaú',/\bitau\b|itaucard/],['Bradesco',/bradesco|bradescard/],
  ['Santander',/santander/],['Caixa',/caixa economica|\bcaixa\b/],['Nubank',/nubank|nu pagamentos/],['Inter',/banco inter|\binter\b/],
  ['C6 Bank',/\bc6\b/],['Banrisul',/banrisul/],['Sicredi',/sicredi/],['Sicoob',/sicoob/],['BTG',/\bbtg\b/],['XP',/\bxp\b (?:visa|cart)|banco xp/],
  ['Porto Bank',/porto seguro|porto bank/],['Mercado Pago',/mercado pago/],['PicPay',/picpay/],['Neon',/\bneon\b/],['Will Bank',/will bank/],
  ['Credicard',/credicard/],['Pan',/banco pan/],['Original',/banco original/],['Next',/\bnext\b/],['Renner',/meu cartao renner|cartao renner/],
];
const brands:[string,RegExp][]=[['Mastercard',/mastercard|\bmaster\b/],['Visa',/\bvisa\b/],['Elo',/\belo\b/],['American Express',/american express|\bamex\b/],['Hipercard',/hipercard/]];
const titleCase=(s:string)=>s.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
/** Dados do cartão na fatura. Campos não encontrados ficam vazios para o usuário completar. */
export function extractCardMeta(text:string):CardMeta {
  const flat=normalize(text);
  const issuer=issuers.find(([,p])=>p.test(flat))?.[0]||'';
  const brand=brands.find(([,p])=>p.test(flat))?.[0]||'';
  const last4=flat.match(/(?:final|terminad[oa] em|cartao n[ºo.]*|n[ºo.] do cartao)[^\d]{0,12}(\d{4})\b/)?.[1]
    ||flat.match(/(?:[*x•]{4}[\s.-]*){1,3}(\d{4})\b/)?.[1]||flat.match(/\b\d{4}[\s.]+[*x•]{4}[\s.]+[*x•]{4}[\s.]+(\d{4})\b/)?.[1]||'';
  const holderLine=text.split(/\r?\n/).map(l=>l.trim()).find(l=>/^(titular|nome do titular|portador|cliente|nome)\s*[:-]/i.test(normalize(l)));
  let holder=holderLine?holderLine.replace(/^[^:-]+[:-]\s*/,''):'';
  if(!holder){const m=text.match(/^\s*([A-ZÀ-Ú][A-ZÀ-Ú ]{5,60}?)\s*[-–]?\s*(?:final|cart[aã]o)\s*[^\d]{0,6}\d{4}/m);if(m)holder=m[1];}
  holder=titleCase(holder.replace(/[^A-Za-zÀ-ÿ\s]/g,' ').replace(/\s+/g,' ').trim()).slice(0,80);
  const ref=flat.match(/vencimento[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/)?.[1]||'';
  const due_date=ref?normalizedDate(ref):'';
  const totalRaw=flat.match(/total (?:desta fatura|da fatura|a pagar|da sua fatura)[^\d-]{0,20}(-?\s*(?:r\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})/)?.[1];
  return {issuer,brand,holder,last4,due_date,total:totalRaw?monetary(totalRaw):'',due_day:due_date?String(Number(due_date.slice(8,10))):''};
}
/** Nome sugerido para o cartão; o usuário pode trocar. */
export function defaultCardName(m:Pick<CardMeta,'issuer'|'brand'|'holder'|'last4'>) {
  const first=m.holder.split(' ')[0]||'';
  return [m.issuer||'Cartão',m.brand,first,m.last4?`•${m.last4}`:''].filter(Boolean).join(' ').slice(0,120);
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
