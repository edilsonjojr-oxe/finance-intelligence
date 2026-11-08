'use client';
import { useEffect,useMemo,useRef,useState,type FormEvent } from 'react';
import { CreditCard,FileText,ShieldCheck,Upload,X } from 'lucide-react';
import type { FinanceState } from '@/lib/types';
import { brl,cents,decimal } from '@/lib/money';
import { defaultCardName,extractCardMeta,extractContract,extractEntries,type CardMeta } from '@/lib/document-extraction';
import { buildMemory,suggestCategory,UNCATEGORIZED } from '@/lib/categorize';
import type { ExtractedItem } from '@/lib/intake';
import { CardFields,accountLabel } from './card-fields';
import Hint from './hint';
import CategorySelect from './category-select';
type Act=(action:string,payload:unknown,message?:string)=>Promise<unknown>;
const fields=[['title','Título'],['counterparty','Instituição / fornecedor'],['amount','Valor mensal / da parcela (R$)'],['total_amount','Valor contratado (R$)'],['start_date','Início da vigência'],['end_date','Fim da vigência'],['renewal_date','Data de renovação'],['months','Quantidade de parcelas'],['due_day','Dia de vencimento'],['interest_rate','Juros (%)'],['cet','CET (%)'],['adjustment_note','Condição de reajuste'],['penalty_note','Multas e encargos']] as const;
export function ContractTerms({values={}}:{values?:Record<string,string>}) {
  return <div className="form-grid"><label className="field"><span>Tipo de contrato</span><select name="contract_type" defaultValue={values.contract_type||'service'}><option value="service">Serviço</option><option value="rent">Aluguel</option><option value="loan">Empréstimo</option><option value="financing">Financiamento</option><option value="subscription">Assinatura</option><option value="other">Outro</option></select></label>{[['rate_period','Período dos juros'],['cet_period','Período do CET']].map(([name,label])=><label className="field" key={name}><span>{label}</span><select name={name} defaultValue={values[name]||''}><option value="">Selecione se houver taxa</option><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>)}</div>;
}
export function normalizeContractForm(form:FormData) {
  const result=Object.fromEntries(form.entries()) as Record<string,unknown>;
  for(const key of ['amount','total_amount','interest_rate','cet']) {
    const raw=String(result[key]||'').trim();result[key]=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
  }
  for(const key of ['total_amount','end_date','renewal_date','interest_rate','cet'])if(!result[key])delete result[key];
  for(const [rate,period] of [['interest_rate','rate_period'],['cet','cet_period']]) {if(result[rate]&&!result[period])throw new Error('Informe o período de cada taxa preenchida.');if(!result[period])delete result[period];}
  result.confirm_distinct=form.get('confirm_distinct')==='on';return result;
}
const cleanMoney=(v:string)=>v.includes(',')?v.replace(/\./g,'').replace(',','.'):v;
/** Cartão já cadastrado que corresponde à fatura: mesmo final e, se houver, mesmo banco. */
function matchCard(meta:CardMeta,accounts:FinanceState['accounts']) {
  const cards=accounts.filter(a=>a.type==='credit_card');
  const byDigits=meta.last4?cards.filter(a=>a.card_last4===meta.last4):[];
  const best=byDigits.find(a=>!meta.issuer||a.institution===meta.issuer)||byDigits[0];
  return best?.id||(cards.length===1&&!meta.last4?cards[0].id:'');
}
export default function SourceIntake({data,act}:{data:FinanceState;act:Act}) {
  const [mode,setMode]=useState('charged'),[rows,setRows]=useState<ExtractedItem[]>([]),[contract,setContract]=useState<Record<string,string>|null>(null);
  const [source,setSource]=useState<{hash:string;type:'document'|'conversation'}|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[account,setAccount]=useState('');
  const [card,setCard]=useState<CardMeta|null>(null),[cardTarget,setCardTarget]=useState('');
  const controller=useRef<AbortController|null>(null);const formRef=useRef<HTMLFormElement>(null);
  const memory=useMemo(()=>buildMemory(data.transactions.filter(t=>t.kind!=='transfer')),[data.transactions]);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  const invoice=card!==null;
  const cards=data.accounts.filter(a=>a.type==='credit_card');
  function clear(){controller.current?.abort();setRows([]);setContract(null);setSource(null);setCard(null);setCardTarget('');setError('');formRef.current?.reset();}
  async function read(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);
    const file=fd.get('document') as File;let text=String(fd.get('text')||'');
    if(file?.size&&text.trim()){setError('Use um documento ou um texto por vez.');return;}
    setBusy(true);setError('');setRows([]);setContract(null);setCard(null);setCardTarget('');controller.current=new AbortController();
    const cancel=controller.current;setProgress('Preparando leitura no seu dispositivo…');
    try{
      const reader=await import('@/lib/document-reader');let digest='';
      if(file?.size){const result=await reader.readDocument(file,setProgress,cancel.signal);text=result.text;digest=result.source_hash;result.text='';}
      else {if(!text.trim()||text.length>50_000)throw new Error('Cole até 50 mil caracteres ou escolha um arquivo.');const bytes=new TextEncoder().encode(text);digest=await reader.documentDigest(bytes);bytes.fill(0);}
      if(cancel.signal.aborted)return;
      setSource({hash:digest,type:file?.size?'document':'conversation'});
      if(mode==='contract')setContract(extractContract(text));
      else {
        const extracted=extractEntries(text,mode as 'paid'|'charged'|'predicted').map(r=>({...r,category:r.category&&r.category!==UNCATEGORIZED?r.category:suggestCategory(r.description,r.kind,memory)}));
        // Itens vindos do leitor de fatura: identificar o cartão e lançar as compras nele.
        if(extracted.some(r=>r.key.startsWith('card-'))){const meta=extractCardMeta(text);setCard(meta);setCardTarget(matchCard(meta,data.accounts)||'new');}
        setRows(extracted);
      }
      setProgress('Leitura concluída. Revise os campos; o original não será guardado.');
    }catch(e){if(!cancel.signal.aborted)setError((e as Error).message);}
    finally{text='';form.reset();setBusy(false);controller.current=null;}
  }
  const update=(index:number,changes:Partial<ExtractedItem>)=>setRows(current=>current.map((r,i)=>i===index?{...r,...changes}:r));
  // Repetidos: mesmo critério do servidor (data, valor, tipo e conta; ou compromisso com mesmo vencimento).
  // Quem já existe NÃO é lançado, a menos que você marque "Lançar mesmo assim".
  const toCents=(v:string)=>{try{return cents(cleanMoney(v));}catch{return null;}};
  const day=(d:string)=>d.split('-').reverse().join('/');
  const targetAccount=invoice?(cardTarget&&cardTarget!=='new'?cardTarget:''):account;
  function existing(r:ExtractedItem):string|undefined {
    const v=toCents(r.amount);if(v===null||!r.date)return undefined;
    const paid=invoice||r.event_type==='paid';
    if(paid&&!r.transaction_id&&targetAccount){const t=data.transactions.find(t=>t.status==='posted'&&t.account_id===targetAccount&&t.date===r.date&&t.kind===r.kind&&cents(t.amount)===v);if(t)return `${t.description} · ${day(t.date)} · ${brl(t.amount)}`;}
    if(r.obligation_id||r.transaction_id)return undefined;
    const o=data.obligations.find(o=>o.status!=='cancelled'&&o.kind===r.kind&&o.due_date===r.date&&cents(o.amount)===v);
    return o?`compromisso ${o.description} · ${day(o.due_date)} · ${brl(o.amount)}`:undefined;
  }
  const dups=rows.map(existing);
  const dupCount=dups.filter(Boolean).length,dupForced=rows.filter((r,i)=>dups[i]&&r.confirm_distinct).length;
  /** Itens a enviar: sem os repetidos não liberados; linhas iguais dentro do mesmo documento são distintas. */
  function itemsToSend(){
    const seen=new Map<string,number>();
    return rows.filter((r,i)=>!dups[i]||r.confirm_distinct).map(r=>{const k=`${r.date}|${r.kind}|${toCents(r.amount)}`;const n=seen.get(k)||0;seen.set(k,n+1);return {...r,amount:cleanMoney(r.amount),confirm_distinct:!!r.confirm_distinct||n>0};});
  }
  async function confirm(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    try{
      if(contract){await act('contract.create',{...normalizeContractForm(form),source_hash:source?.hash},'Contrato confirmado e obrigações geradas.');}
      else if(invoice){
        let cardId=cardTarget;
        const earliest=rows.map(r=>r.date).filter(Boolean).sort()[0]||data.today;
        if(cardId==='new'){
          const fieldsOf=Object.fromEntries(form.entries()) as Record<string,string>;
          const created=await act('account.create',{type:'credit_card',name:fieldsOf.card_name,institution:fieldsOf.card_institution||'',
            opening_balance:'0',opening_date:earliest<data.today?earliest:data.today,card_brand:fieldsOf.card_brand,card_holder:fieldsOf.card_holder,
            card_last4:fieldsOf.card_last4,closing_day:fieldsOf.closing_day,due_day:fieldsOf.due_day,credit_limit:fieldsOf.credit_limit?cleanMoney(fieldsOf.credit_limit):''},'Cartão cadastrado.') as {id:string};
          cardId=created.id;setCardTarget(cardId);
        }
        if(!cardId)throw new Error('Escolha o cartão desta fatura.');
        const items=itemsToSend();if(!items.length)throw new Error('Todas as compras já estão lançadas neste cartão. Nada novo para confirmar.');
        const target=data.accounts.find(a=>a.id===cardId);
        if(target&&earliest<target.opening_date)throw new Error(`Há compras de ${earliest}, antes do início do cartão (${target.opening_date}). Remova essas linhas ou use outro cartão.`);
        // Compras já aconteceram: entram como despesas (estornos como crédito) no cartão, na data da compra.
        await act('intake.confirm',{source_type:source?.type,source_hash:source?.hash,account_id:cardId,
          items:items.map(r=>({...r,event_type:'paid',obligation_id:undefined,transaction_id:undefined}))},
          `${items.length} compra(s) lançada(s) no cartão${rows.length>items.length?`; ${rows.length-items.length} repetida(s) ignorada(s)`:''}. O total da fatura fica como saldo do cartão até o pagamento.`);
      }
      else {const items=itemsToSend();if(!items.length)throw new Error('Todos os itens já estão lançados. Nada novo para confirmar.');
        await act('intake.confirm',{source_type:source?.type,source_hash:source?.hash,account_id:account||undefined,items},`${items.length} registro(s) confirmado(s)${rows.length>items.length?`; ${rows.length-items.length} repetido(s) ignorado(s)`:''}.`);}
      clear();setProgress('Dados estruturados salvos. Arquivo e texto não foram armazenados.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const invoiceTotal=rows.reduce((n,r)=>{try{const v=cents(cleanMoney(r.amount));return r.kind==='income'?n-v:n+v;}catch{return n;}},0n);
  return <section className="panel source-intake"><div className="panel-heading"><div><h2><FileText size={18}/> Documento, print ou conversa</h2><p>PDF com texto, PNG/JPEG ou TXT · até 8 MB</p></div><ShieldCheck size={21}/></div>
    <div className="padded-form"><Hint short="Lido no seu aparelho. O arquivo não é guardado.">Somente os campos que você confirmar vão para a sua base. A liberação da memória não garante a exclusão de cópias mantidas pelo dispositivo ou por terceiros.</Hint>
    <form onSubmit={read} ref={formRef}><div className="form-grid"><label className="field"><span>O que deseja identificar?</span><select value={mode} disabled={busy} onChange={e=>{clear();setMode(e.target.value);}}><option value="charged">Cobrança / boleto / fatura</option><option value="paid">Pagamento / recebimento realizado</option><option value="predicted">Compromisso previsto</option><option value="contract">Condições de contrato</option></select></label><label className="field"><span>Documento para leitura</span><input name="document" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={busy}/></label></div><label className="field"><span>Ou cole um texto autorizado</span><textarea name="text" maxLength={50_000} disabled={busy} placeholder={'Descrição: Internet\nVencimento: 12/11/2026\nValor: R$ 129,90'}/></label>
    <div className="row-actions"><button className="button" disabled={busy}><Upload size={16}/> {busy?'Lendo…':'Ler documento'}</button>{busy&&<button type="button" className="button" onClick={()=>{controller.current?.abort();setProgress('Leitura cancelada.');}}>Cancelar</button>}</div></form>
    {progress&&<p role="status" className="page-footnote">{progress}</p>}{error&&<p className="error" role="alert">{error}</p>}
    {source&&(rows.length>0||contract)&&<form onSubmit={confirm} className="intake-review"><div className="panel-heading"><h2>Revise antes de confirmar</h2><button type="button" className="text-button" disabled={busy} onClick={clear}><X size={15}/> Descartar leitura</button></div>
    {invoice&&card?<div className="invoice-card">
      <h3><CreditCard size={18}/> Fatura de cartão identificada</h3>
      <p className="form-help">{[card.issuer,card.brand,card.holder,card.last4&&`final ${card.last4}`].filter(Boolean).join(' · ')||'Banco, bandeira e titular não identificados — preencha abaixo.'}{card.due_date&&` · vencimento ${new Date(card.due_date+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'UTC'})}`}{card.total&&` · total da fatura ${brl(card.total)}`}</p>
      <label className="field"><span>Cartão desta fatura</span><select value={cardTarget} onChange={e=>setCardTarget(e.target.value)} required><option value="new">Cadastrar este cartão</option>{cards.map(a=><option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>
      {cardTarget==='new'&&<><div className="form-grid"><label className="field"><span>Nome do cartão (pode alterar)</span><input name="card_name" required maxLength={120} defaultValue={defaultCardName(card)}/></label><label className="field"><span>Banco / emissor</span><input name="card_institution" maxLength={120} defaultValue={card.issuer}/></label></div>
        <CardFields values={{card_brand:card.brand,card_holder:card.holder,card_last4:card.last4,due_day:card.due_day?Number(card.due_day):null}}/></>}
      <Hint short={<>{rows.length} compras · soma {brl(decimal(invoiceTotal<0n?-invoiceTotal:invoiceTotal))}{card.total&&cents(card.total)!==invoiceTotal&&<strong> · diferente do total da fatura</strong>}</>}>As compras entram como despesas deste cartão, na data de cada compra, com a categoria sugerida (você pode trocar). O total da fatura não é lançado de novo; para quitá-la, registre o pagamento como transferência da sua conta para o cartão.</Hint>
    </div>:<Hint short="Confira os campos antes de confirmar.">Extração por regras, sujeita a falhas. Campos não identificados ficam vazios. Não inclua ao mesmo tempo o total de uma fatura e cada compra. Hipóteses ficam como estimativas.</Hint>}
    {contract?<><ContractTerms values={contract}/><div className="form-grid">{fields.map(([key,label])=><label className="field" key={key}><span>{label}</span><input name={key} defaultValue={contract[key]||''} required={['title','counterparty','amount','start_date','months','due_day'].includes(key)} type={key.endsWith('_date')?'date':key==='months'||key==='due_day'?'number':'text'} min="1" max={key==='months'?60:key==='due_day'?31:undefined} maxLength={key.includes('note')?500:160}/></label>)}</div><label className="field"><span>Categoria</span><input name="category" list="category-list" defaultValue="Sem categoria" maxLength={80} required/></label><label className="checkbox-label"><input name="confirm_distinct" type="checkbox"/> Se houver contrato semelhante, confirmo que este é distinto.</label></>:<>
      {!invoice&&rows.some(r=>r.event_type==='paid')&&<label className="field"><span>Conta dos pagamentos realizados</span><select value={account} onChange={e=>setAccount(e.target.value)} required><option value="">Selecione</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>}
      {dupCount>0&&<div className="dup-summary" role="status"><p><strong>{dupCount} {dupCount===1?'item já está lançado':'itens já estão lançados'}</strong> (mesma data, valor e conta). {dupForced===dupCount?(dupCount===1?'Será lançado de novo.':'Serão lançados de novo.'):dupForced?`${dupCount-dupForced} não serão lançados.`:(dupCount===1?'Não será lançado.':'Não serão lançados.')}</p>
        <button type="button" className="text-button" onClick={()=>{const all=dupForced<dupCount;setRows(c=>c.map((r,i)=>dups[i]?{...r,confirm_distinct:all}:r));}}>{dupForced<dupCount?'Lançar todos mesmo assim':'Não lançar os repetidos'}</button></div>}
      {rows.map((r,i)=>{const matches=data.obligations.filter(o=>o.status!=='cancelled'&&o.kind===r.kind&&Number(o.amount)===Number(r.amount.replace(',','.')));
        const payments=data.transactions.filter(t=>t.status==='posted'&&t.kind===r.kind&&t.account_id===account&&Number(t.amount)===Number(r.amount.replace(',','.')));
        return <fieldset className={`intake-item ${dups[i]&&!r.confirm_distinct?'is-duplicate':''}`} key={r.key}><legend>{invoice?`Compra ${i+1}`:`Registro ${i+1}`}{dups[i]&&<span className="badge orange">{r.confirm_distinct?'Repetido · será lançado':'Já lançado · não será lançado'}</span>}</legend>
        {dups[i]&&<p className="dup-note">Igual a: {dups[i]} <label className="checkbox-label"><input type="checkbox" checked={!!r.confirm_distinct} onChange={e=>update(i,{confirm_distinct:e.target.checked})}/> Lançar mesmo assim</label></p>}<div className="form-grid"><label className="field"><span>Descrição</span><input required maxLength={160} value={r.description} onChange={e=>update(i,{description:e.target.value})}/></label><label className="field"><span>Valor (R$)</span><input required inputMode="decimal" value={r.amount} onChange={e=>update(i,{amount:e.target.value})}/></label><label className="field"><span>{invoice?'Data da compra':'Data do evento / vencimento'}</span><input required type="date" value={r.date} onChange={e=>update(i,{date:e.target.value})}/></label><CategorySelect label={r.category!==UNCATEGORIZED?"Categoria (sugerida)":"Categoria"} value={r.category} onChange={v=>update(i,{category:v})}/><label className="field"><span>Tipo</span><select value={r.kind} onChange={e=>update(i,{kind:e.target.value as 'income'|'expense',obligation_id:undefined,transaction_id:undefined})}><option value="expense">{invoice?'Compra':'Despesa'}</option><option value="income">{invoice?'Estorno / crédito':'Receita'}</option></select></label>{!invoice&&<label className="field"><span>Situação</span><select value={r.event_type} onChange={e=>update(i,{event_type:e.target.value as ExtractedItem['event_type'],transaction_id:undefined})}><option value="predicted">Previsto</option><option value="charged">Cobrado</option><option value="paid">Pago / recebido</option><option value="estimated">Estimado</option></select></label>}</div>
        {!invoice&&<label className="field"><span>Vincular ao mesmo compromisso</span><select value={r.obligation_id||''} onChange={e=>update(i,{obligation_id:e.target.value||undefined})}><option value="">Nenhum — criar registro distinto</option>{matches.map(o=><option key={o.id} value={o.id}>{o.description} · {o.due_date} · {brl(o.amount)} · {o.status==='paid'?'já pago':'em aberto'}</option>)}</select></label>}
        {!invoice&&r.event_type==='paid'&&<label className="field"><span>Pagamento já cadastrado / importado</span><select value={r.transaction_id||''} onChange={e=>update(i,{transaction_id:e.target.value||undefined})}><option value="">Registrar nova movimentação</option>{payments.map(t=><option key={t.id} value={t.id}>{t.description} · {t.date} · {brl(t.amount)}</option>)}</select></label>}
        <button className="text-button" type="button" onClick={()=>setRows(current=>current.filter((_,index)=>index!==i))}>Remover da seleção</button></fieldset>;})}
    </>}
    <button className="button primary" disabled={busy}>{busy?'Confirmando…':invoice?`Lançar ${rows.length-dupCount+dupForced} compra(s) no cartão`:`Confirmar ${rows.length-dupCount+dupForced} registro(s)`}</button></form>}
    </div></section>;
}
