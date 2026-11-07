'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import { FileText,ShieldCheck,Upload,X } from 'lucide-react';
import type { FinanceState } from '@/lib/types';
import { brl,cents } from '@/lib/money';
import { extractContract,extractEntries } from '@/lib/document-extraction';
import type { ExtractedItem } from '@/lib/intake';
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
export default function SourceIntake({data,act}:{data:FinanceState;act:Act}) {
  const [mode,setMode]=useState('charged'),[rows,setRows]=useState<ExtractedItem[]>([]),[contract,setContract]=useState<Record<string,string>|null>(null);
  const [source,setSource]=useState<{hash:string;type:'document'|'conversation'}|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[account,setAccount]=useState('');
  const controller=useRef<AbortController|null>(null);const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  function clear(){controller.current?.abort();setRows([]);setContract(null);setSource(null);setError('');formRef.current?.reset();}
  async function read(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);
    const file=fd.get('document') as File;let text=String(fd.get('text')||'');
    if(file?.size&&text.trim()){setError('Use um documento ou um texto por vez.');return;}
    setBusy(true);setError('');setRows([]);setContract(null);controller.current=new AbortController();
    const cancel=controller.current;setProgress('Preparando leitura no seu dispositivo…');
    try{
      const reader=await import('@/lib/document-reader');let digest='';
      if(file?.size){const result=await reader.readDocument(file,setProgress,cancel.signal);text=result.text;digest=result.source_hash;result.text='';}
      else {if(!text.trim()||text.length>50_000)throw new Error('Cole até 50 mil caracteres ou escolha um arquivo.');const bytes=new TextEncoder().encode(text);digest=await reader.documentDigest(bytes);bytes.fill(0);}
      if(cancel.signal.aborted)return;
      setSource({hash:digest,type:file?.size?'document':'conversation'});
      if(mode==='contract')setContract(extractContract(text));else setRows(extractEntries(text,mode as 'paid'|'charged'|'predicted'));
      setProgress('Leitura concluída. Revise os campos; o original não será guardado.');
    }catch(e){if(!cancel.signal.aborted)setError((e as Error).message);}
    finally{text='';form.reset();setBusy(false);controller.current=null;}
  }
  const update=(index:number,changes:Partial<ExtractedItem>)=>setRows(current=>current.map((r,i)=>i===index?{...r,...changes}:r));
  async function confirm(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    try{if(contract){await act('contract.create',{...normalizeContractForm(new FormData(event.currentTarget)),source_hash:source?.hash},'Contrato confirmado e obrigações geradas.');}
    else await act('intake.confirm',{source_type:source?.type,source_hash:source?.hash,account_id:account||undefined,items:rows.map(r=>({...r,amount:r.amount.includes(',')?r.amount.replace(/\./g,'').replace(',','.'):r.amount,confirm_distinct:!!r.confirm_distinct}))},'Dados confirmados. Fontes conciliadas sem guardar o original.');
    clear();setProgress('Dados estruturados salvos. Arquivo e texto não foram armazenados.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel source-intake"><div className="panel-heading"><div><h2><FileText size={18}/> Ler documento ou conversa</h2><p>PDF com texto, PNG/JPEG com OCR ou TXT · até 8 MB</p></div><ShieldCheck size={21}/></div>
    <div className="padded-form"><p className="form-help">A leitura ocorre no seu navegador. Somente os campos confirmados são enviados para sua base. Nenhum documento original é guardado. A liberação da memória não permite garantir exclusão de cópias mantidas pelo dispositivo ou por terceiros.</p>
    <form onSubmit={read} ref={formRef}><div className="form-grid"><label className="field"><span>O que deseja identificar?</span><select value={mode} disabled={busy} onChange={e=>{clear();setMode(e.target.value);}}><option value="charged">Cobrança / boleto / fatura</option><option value="paid">Pagamento / recebimento realizado</option><option value="predicted">Compromisso previsto</option><option value="contract">Condições de contrato</option></select></label><label className="field"><span>Documento para leitura</span><input name="document" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={busy}/></label></div><label className="field"><span>Ou cole um texto autorizado</span><textarea name="text" maxLength={50_000} disabled={busy} placeholder={'Descrição: Internet\nVencimento: 12/11/2026\nValor: R$ 129,90'}/></label>
    <div className="row-actions"><button className="button" disabled={busy}><Upload size={16}/> {busy?'Lendo…':'Ler e preparar revisão'}</button>{busy&&<button type="button" className="button" onClick={()=>{controller.current?.abort();setProgress('Leitura cancelada.');}}>Cancelar leitura</button>}</div></form>
    {progress&&<p role="status" className="page-footnote">{progress}</p>}{error&&<p className="error" role="alert">{error}</p>}
    {source&&(rows.length>0||contract)&&<form onSubmit={confirm} className="intake-review"><div className="panel-heading"><h2>Revisar antes de confirmar</h2><button type="button" className="text-button" disabled={busy} onClick={clear}><X size={15}/> Descartar leitura</button></div><p className="form-help">Extração assistida por regras, sujeita a falhas. Campos não identificados ficam vazios. Valores de fatura são compromissos; não inclua simultaneamente o total e cada compra. As hipóteses permanecem como estimativas.</p>
    {contract?<><ContractTerms values={contract}/><div className="form-grid">{fields.map(([key,label])=><label className="field" key={key}><span>{label}</span><input name={key} defaultValue={contract[key]||''} required={['title','counterparty','amount','start_date','months','due_day'].includes(key)} type={key.endsWith('_date')?'date':key==='months'||key==='due_day'?'number':'text'} min="1" max={key==='months'?60:key==='due_day'?31:undefined} maxLength={key.includes('note')?500:160}/></label>)}</div><label className="field"><span>Categoria</span><input name="category" defaultValue="Sem categoria" maxLength={80} required/></label><label className="checkbox-label"><input name="confirm_distinct" type="checkbox"/> Se houver contrato semelhante, confirmo que este é distinto.</label></>:<>
      {rows.some(r=>r.event_type==='paid')&&<label className="field"><span>Conta dos pagamentos realizados</span><select value={account} onChange={e=>setAccount(e.target.value)} required><option value="">Selecione</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      {rows.map((r,i)=>{const matches=data.obligations.filter(o=>o.status!=='cancelled'&&o.kind===r.kind&&Number(o.amount)===Number(r.amount.replace(',','.')));
        const payments=data.transactions.filter(t=>t.status==='posted'&&t.kind===r.kind&&t.account_id===account&&Number(t.amount)===Number(r.amount.replace(',','.')));
        return <fieldset className="intake-item" key={r.key}><legend>Registro {i+1} · extraído, ainda não confirmado</legend><div className="form-grid"><label className="field"><span>Descrição</span><input required maxLength={160} value={r.description} onChange={e=>update(i,{description:e.target.value})}/></label><label className="field"><span>Valor (R$)</span><input required inputMode="decimal" value={r.amount} onChange={e=>update(i,{amount:e.target.value})}/></label><label className="field"><span>Data do evento / vencimento</span><input required type="date" value={r.date} onChange={e=>update(i,{date:e.target.value})}/></label><label className="field"><span>Categoria</span><input required maxLength={80} value={r.category} onChange={e=>update(i,{category:e.target.value})}/></label><label className="field"><span>Tipo</span><select value={r.kind} onChange={e=>update(i,{kind:e.target.value as 'income'|'expense',obligation_id:undefined,transaction_id:undefined})}><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label className="field"><span>Situação</span><select value={r.event_type} onChange={e=>update(i,{event_type:e.target.value as ExtractedItem['event_type'],transaction_id:undefined})}><option value="predicted">Previsto</option><option value="charged">Cobrado</option><option value="paid">Pago / recebido</option><option value="estimated">Estimado</option></select></label></div>
        <label className="field"><span>Vincular ao mesmo compromisso</span><select value={r.obligation_id||''} onChange={e=>update(i,{obligation_id:e.target.value||undefined})}><option value="">Nenhum — criar registro distinto</option>{matches.map(o=><option key={o.id} value={o.id}>{o.description} · {o.due_date} · {brl(o.amount)} · {o.status==='paid'?'já pago':'em aberto'}</option>)}</select></label>
        {r.event_type==='paid'&&<label className="field"><span>Pagamento já cadastrado / importado</span><select value={r.transaction_id||''} onChange={e=>update(i,{transaction_id:e.target.value||undefined})}><option value="">Registrar nova movimentação</option>{payments.map(t=><option key={t.id} value={t.id}>{t.description} · {t.date} · {brl(t.amount)}</option>)}</select></label>}
        <label className="checkbox-label"><input type="checkbox" checked={!!r.confirm_distinct} onChange={e=>update(i,{confirm_distinct:e.target.checked})}/> Revisei os semelhantes e confirmo que este registro é distinto.</label><button className="text-button" type="button" onClick={()=>setRows(current=>current.filter((_,index)=>index!==i))}>Remover da seleção</button></fieldset>;})}
    </>}
    <button className="button primary" disabled={busy}>{busy?'Confirmando…':'Confirmar dados revisados'}</button></form>}
    </div></section>;
}
