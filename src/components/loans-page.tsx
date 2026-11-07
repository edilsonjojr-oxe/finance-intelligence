'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Camera, Check, HandCoins, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Contract, FinanceState, Obligation } from '@/lib/types';
import { addDays, brl, cents, decimal, recurrenceDates } from '@/lib/money';
import { parseScheduleText } from '@/lib/spreadsheet-import';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
type Row = { date: string; amount: string; paid: boolean };
const LOAN_TYPES = ['loan', 'agreement', 'financing'];
const typeLabel: Record<string, string> = { loan: 'Empréstimo', agreement: 'Acordo', financing: 'Financiamento' };
const toCents = (v: string) => { try { return cents(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v || '0'); } catch { return null; } };
const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** Prévia das parcelas, igual ao cálculo do servidor (diferença de centavos na última). */
function preview(mode: string, total: string, each: string, n: number, first: string, paid: number): Row[] {
  if (!n || n < 1 || n > 360 || !first) return [];
  const dates = recurrenceDates(first, n, Number(first.slice(8, 10)));
  let amounts: string[] = [];
  if (mode === 'total') {
    const t = toCents(total); if (!t) return [];
    const base = t / BigInt(n);
    amounts = dates.map((_, i) => decimal(i === n - 1 ? t - base * BigInt(n - 1) : base));
  } else { const e = toCents(each); if (!e) return []; amounts = dates.map(() => decimal(e)); }
  return dates.map((d, i) => ({ date: d, amount: amounts[i], paid: i < paid }));
}

function LoanForm({ data, act, onDone }: { data: FinanceState; act: Act; onDone: () => void }) {
  const [direction, setDirection] = useState<'payable' | 'receivable'>('payable');
  const [mode, setMode] = useState<'total' | 'installment' | 'schedule'>('total');
  const [total, setTotal] = useState(''), [each, setEach] = useState(''), [n, setN] = useState('');
  const [first, setFirst] = useState(addDays(data.today, 30)), [paid, setPaid] = useState('0');
  const [rows, setRows] = useState<Row[]>([]), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const plan = mode === 'schedule' ? rows : preview(mode, total, each, Number(n), first, Number(paid));
  const sum = plan.reduce((acc, r) => acc + (toCents(r.amount) || 0n), 0n);

  async function readPrint(file: File) {
    setBusy(true); setError(''); setProgress('Lendo o print no seu dispositivo…');
    try {
      const reader = await import('@/lib/document-reader');
      const result = await reader.readDocument(file, setProgress);
      const found = parseScheduleText(result.text, data.today); result.text = '';
      if (!found.length) throw new Error('Não encontrei linhas com data e valor. Digite as parcelas ou cole o texto.');
      setRows(found.map((p) => ({ ...p, amount: p.amount.replace('.', ',') })));
      setProgress(`${found.length} parcelas encontradas. Confira antes de salvar; o print não é guardado.`);
    } catch (e) { setError((e as Error).message); setProgress(''); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true); setError('');
    try {
      const clean = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
      const base = { direction, counterparty: f.counterparty, title: f.title, contract_type: f.contract_type, category: f.category, note: f.note, mode };
      const payload = mode === 'schedule'
        ? { ...base, schedule: rows.filter((r) => toCents(r.amount)).map((r) => ({ date: r.date, amount: clean(r.amount), paid: r.paid })) }
        : { ...base, total_amount: mode === 'total' ? clean(total) : undefined, installment_amount: mode === 'installment' ? clean(each) : undefined, installments: n, first_due_date: first, paid_count: paid };
      await act('loan.create', payload, direction === 'payable' ? 'Empréstimo cadastrado. As parcelas entraram em Compromissos e na projeção.' : 'Valor a receber cadastrado. As parcelas entraram na projeção.');
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const set = (i: number, c: Partial<Row>) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...c } : r)));
  return (
    <form onSubmit={submit} className="panel loan-form padded-form">
      <div className="auth-switch" role="tablist" aria-label="Direção">
        <button type="button" role="tab" aria-selected={direction === 'payable'} className={direction === 'payable' ? 'active' : ''} onClick={() => setDirection('payable')}>Peguei emprestado (eu devo)</button>
        <button type="button" role="tab" aria-selected={direction === 'receivable'} className={direction === 'receivable' ? 'active' : ''} onClick={() => setDirection('receivable')}>Emprestei (me devem)</button>
      </div>
      <div className="form-grid">
        <label className="field"><span>{direction === 'payable' ? 'De quem (pessoa ou instituição)' : 'Para quem'}</span><input name="counterparty" required maxLength={120} placeholder="Ex.: Laura, Santander" /></label>
        <label className="field"><span>Descrição (opcional)</span><input name="title" maxLength={120} placeholder="Ex.: Empréstimo Apple Watch" /></label>
        <label className="field"><span>Tipo</span><select name="contract_type" defaultValue="loan"><option value="loan">Empréstimo</option><option value="agreement">Acordo de dívida</option><option value="financing">Financiamento</option></select></label>
        <label className="field"><span>Categoria (opcional)</span><input name="category" list="category-list" maxLength={80} autoComplete="off" placeholder={direction === 'payable' ? 'Dívidas e empréstimos / Parcelas de empréstimo' : 'Receitas / Empréstimos a receber'} /></label>
      </div>
      <div className="auth-switch three" role="tablist" aria-label="Como informar as parcelas">
        <button type="button" role="tab" aria-selected={mode === 'total'} className={mode === 'total' ? 'active' : ''} onClick={() => setMode('total')}>Valor total</button>
        <button type="button" role="tab" aria-selected={mode === 'installment'} className={mode === 'installment' ? 'active' : ''} onClick={() => setMode('installment')}>Valor da parcela</button>
        <button type="button" role="tab" aria-selected={mode === 'schedule'} className={mode === 'schedule' ? 'active' : ''} onClick={() => setMode('schedule')}>Uma a uma / print</button>
      </div>
      {mode !== 'schedule' ? (
        <div className="form-grid">
          {mode === 'total'
            ? <label className="field"><span>Valor total (R$)</span><input inputMode="decimal" required pattern="[0-9.,]+" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="1.000,00" /></label>
            : <label className="field"><span>Valor de cada parcela (R$)</span><input inputMode="decimal" required pattern="[0-9.,]+" value={each} onChange={(e) => setEach(e.target.value)} placeholder="250,00" /></label>}
          <label className="field"><span>Número de parcelas</span><input type="number" min={1} max={360} required value={n} onChange={(e) => setN(e.target.value)} /></label>
          <label className="field"><span>1º vencimento</span><input type="date" required value={first} onChange={(e) => setFirst(e.target.value)} /><small>As próximas vencem no mesmo dia dos meses seguintes.</small></label>
          <label className="field"><span>Parcelas já pagas</span><input type="number" min={0} max={Number(n) || 0} value={paid} onChange={(e) => setPaid(e.target.value)} /><small>Ficam como pagas, sem mexer no saldo.</small></label>
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label className="field"><span><Camera size={14} /> Ler print ou PDF com as parcelas</span><input type="file" accept=".png,.jpg,.jpeg,.pdf,.txt" disabled={busy} onChange={(e) => e.target.files?.[0] && readPrint(e.target.files[0])} /></label>
            <label className="field"><span>Ou cole o texto (uma parcela por linha: data e valor)</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'10/12/2026 R$ 250,00\n10/01/2027 R$ 250,00'} /></label>
          </div>
          <div className="row-actions">
            <button type="button" className="text-button" disabled={!text.trim()} onClick={() => { const found = parseScheduleText(text, data.today); if (!found.length) setError('Nenhuma linha com data e valor.'); else { setRows(found.map((p) => ({ ...p, amount: p.amount.replace('.', ',') }))); setError(''); } }}>Usar o texto colado</button>
            <button type="button" className="text-button" onClick={() => setRows((cur) => [...cur, { date: cur.length ? addDays(cur.at(-1)!.date, 30) : first, amount: '', paid: false }])}><Plus size={14} /> Adicionar parcela</button>
          </div>
          {progress && <p role="status" className="page-footnote">{progress}</p>}
          {rows.map((r, i) => (
            <div className="schedule-row" key={i}>
              <span>{i + 1}ª</span>
              <input type="date" required value={r.date} onChange={(e) => set(i, { date: e.target.value })} aria-label={`Vencimento da parcela ${i + 1}`} />
              <input inputMode="decimal" required pattern="[0-9.,]+" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Valor da parcela ${i + 1}`} placeholder="0,00" />
              <label className="checkbox-label"><input type="checkbox" checked={r.paid} onChange={(e) => set(i, { paid: e.target.checked })} /> paga</label>
              <button type="button" className="icon-button" aria-label={`Remover parcela ${i + 1}`} onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </>
      )}
      {plan.length > 0 && (
        <p className="form-help">
          {plan.length} parcelas · total {brl(decimal(sum))} · {plan.filter((p) => p.paid).length} já pagas · primeira {fmtDate(plan[0].date)}
          {mode !== 'schedule' && plan.length > 1 && ` (${brl(plan[0].amount)}${plan.at(-1)!.amount !== plan[0].amount ? `, última ${brl(plan.at(-1)!.amount)}` : ''})`} · última {fmtDate(plan.at(-1)!.date)}
        </p>
      )}
      <label className="field"><span>Observação (opcional)</span><input name="note" maxLength={500} placeholder="Ex.: combinado por mensagem em 03/11" /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row-actions">
        <button className="button primary" disabled={busy || !plan.length}><Check size={16} /> Salvar e gerar parcelas</button>
        <button type="button" className="button" onClick={onDone}><X size={16} /> Cancelar</button>
      </div>
    </form>
  );
}

export default function LoansPage({ data, act, onPay }: { data: FinanceState; act: Act; onPay: (obligationId: string) => void }) {
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const loans = useMemo(() => data.contracts.filter((c) => LOAN_TYPES.includes(c.contract_type || '') || c.direction === 'receivable'), [data.contracts]);
  const parcelsOf = (c: Contract) => data.obligations.filter((o) => o.contract_id === c.id && o.status !== 'cancelled').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const owed = (dir: string) => loans.filter((c) => (c.direction || 'payable') === dir).reduce((n, c) => n + parcelsOf(c).filter((o) => o.status === 'open').reduce((m, o) => m + cents(o.amount), 0n), 0n);
  async function run(action: string, o: Obligation, message: string) { setBusy(true); try { await act(action, { id: o.id }, message); } catch { /* erro exibido pelo app */ } finally { setBusy(false); } }
  return (
    <>
      <div className="metrics loans-metrics">
        <div className="metric"><div className="metric-label">Você deve <span className="metric-icon orange"><ArrowUpRight size={17} /></span></div><strong>{brl(decimal(owed('payable')))}</strong><span>Parcelas em aberto de empréstimos e acordos</span></div>
        <div className="metric"><div className="metric-label">Te devem <span className="metric-icon green"><ArrowDownLeft size={17} /></span></div><strong>{brl(decimal(owed('receivable')))}</strong><span>Parcelas a receber</span></div>
      </div>
      {creating ? <LoanForm data={data} act={act} onDone={() => setCreating(false)} /> : (
        <div className="row-actions"><button className="button primary" onClick={() => setCreating(true)}><Plus size={16} /> Novo empréstimo ou acordo</button></div>
      )}
      {loans.length === 0 && !creating && (
        <section className="panel padded-form"><p className="form-help"><HandCoins size={16} /> Nenhum empréstimo ainda. Cadastre ou importe da planilha em Importações.</p></section>
      )}
      <div className="loan-list">
        {loans.map((c) => {
          const parcels = parcelsOf(c), open = parcels.filter((o) => o.status === 'open'), done = parcels.length - open.length;
          const rest = open.reduce((n, o) => n + cents(o.amount), 0n), next = open[0];
          const payable = (c.direction || 'payable') === 'payable';
          return (
            <section key={c.id} className="panel loan-card">
              <div className="loan-head">
                <div>
                  <span className={`loan-badge ${payable ? 'owe' : 'owed'}`}>{payable ? 'Eu devo' : 'Me devem'} · {typeLabel[c.contract_type || ''] || 'Empréstimo'}</span>
                  <h2>{c.title}</h2>
                  {c.counterparty && c.counterparty !== c.title && <p>{payable ? 'Credor' : 'Devedor'}: {c.counterparty}</p>}
                </div>
                <div className="loan-amount"><strong>{brl(decimal(rest))}</strong><small>{open.length ? 'em aberto' : 'quitado'}</small></div>
              </div>
              <div className="bar-track" aria-label={`${done} de ${parcels.length} parcelas pagas`}><span className="shade-0" style={{ width: `${parcels.length ? (done * 100) / parcels.length : 0}%` }} /></div>
              <p className="form-help">{done} de {parcels.length} parcelas pagas{next ? ` · próxima ${fmtDate(next.due_date)} · ${brl(next.amount)}` : ''}{next && next.due_date < data.today ? ' · vencida' : ''}</p>
              <details>
                <summary>Ver parcelas</summary>
                <ul className="parcel-list">
                  {parcels.map((o, i) => (
                    <li key={o.id} className={o.status}>
                      <span>{i + 1}ª · {fmtDate(o.due_date)}</span>
                      <span>{brl(o.amount)}</span>
                      <span className="parcel-status">{o.status === 'paid' ? (o.settled_transaction_id ? 'Paga (lançada)' : 'Paga') : o.due_date < data.today ? 'Vencida' : 'Em aberto'}</span>
                      <span className="parcel-actions">
                        {o.status === 'open' && <>
                          <button type="button" className="text-button" disabled={busy} onClick={() => onPay(o.id)}>{payable ? 'Pagar' : 'Receber'}</button>
                          <button type="button" className="text-button" disabled={busy} onClick={() => run('obligation.mark_paid', o, 'Parcela marcada como paga (sem lançamento na conta).')}>Já {payable ? 'paga' : 'recebida'}</button>
                        </>}
                        {o.status === 'paid' && !o.settled_transaction_id && <button type="button" className="text-button" disabled={busy} onClick={() => run('obligation.reopen', o, 'Parcela reaberta.')}><RotateCcw size={12} /> Reabrir</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          );
        })}
      </div>
    </>
  );
}
