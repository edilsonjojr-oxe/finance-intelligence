'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { Check, ReceiptText, Trash2, X } from 'lucide-react';
import type { FinanceState } from '@/lib/types';
import { addDays, brl, cents, decimal } from '@/lib/money';
import { parseReceipt, productMemory, receiptParts, type ReceiptItem } from '@/lib/receipt';
import { accountLabel } from './card-fields';
import Hint from './hint';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
const clean = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
const fmt = (d: string) => d.split('-').reverse().join('/');

/** Nota de mercado: itens por categoria e divisão automática da compra correspondente. */
export default function ReceiptImport({ data, act }: { data: FinanceState; act: Act }) {
  const [items, setItems] = useState<ReceiptItem[]>([]), [store, setStore] = useState(''), [date, setDate] = useState(''), [paid, setPaid] = useState('');
  const [target, setTarget] = useState(''), [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState(''), [text, setText] = useState('');
  const memory = useMemo(() => productMemory(data.splits), [data.splits]);
  const paidCents = (() => { try { return cents(clean(paid) || '0'); } catch { return 0n; } })();
  const matches = useMemo(() => data.transactions.filter((t) => t.status === 'posted' && t.kind === 'expense' && paidCents > 0n && cents(t.amount) === paidCents
    && (!date || (t.date >= addDays(date, -3) && t.date <= addDays(date, 3)))), [data.transactions, paidCents, date]);
  const gross = items.reduce((n, i) => { try { return n + cents(clean(i.amount)); } catch { return n; } }, 0n);

  function load(raw: string) {
    const r = parseReceipt(raw, memory);
    if (!r.items.length) throw new Error('Não encontrei itens com valor. Confira a imagem ou cole o texto da nota.');
    setItems(r.items.map((i) => ({ ...i, amount: i.amount.replace('.', ',') })));
    setStore(r.store); setDate(r.date); setPaid((r.total || '').replace('.', ','));
    const total = r.total ? cents(r.total) : 0n;
    const m = data.transactions.find((t) => t.status === 'posted' && t.kind === 'expense' && total > 0n && cents(t.amount) === total && (!r.date || (t.date >= addDays(r.date, -3) && t.date <= addDays(r.date, 3))));
    setTarget(m ? m.id : 'new');
    setInfo(`${r.items.length} itens lidos${r.discount ? ` · desconto ${brl(r.discount)}` : ''}${m ? ' · compra encontrada' : ''}.`);
  }
  async function readFile(file: File) {
    setBusy(true); setError(''); setInfo('Lendo a nota no seu aparelho…');
    try { const reader = await import('@/lib/document-reader'); const r = await reader.readDocument(file, setInfo); load(r.text); r.text = ''; }
    catch (e) { setError((e as Error).message); setInfo(''); }
    finally { setBusy(false); }
  }
  function reset() { setItems([]); setStore(''); setDate(''); setPaid(''); setTarget(''); setInfo(''); setError(''); setText(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let id = target;
      if (target === 'new') {
        if (!account) throw new Error('Escolha a conta ou o cartão da compra.');
        const d = date && date <= data.today ? date : data.today;
        const created = await act('movement.create', { account_id: account, kind: 'expense', amount: decimal(paidCents), date: d, competence: d, description: store || 'Compra no mercado', category: 'Alimentação / Mercado' }, 'Compra registrada.') as { id: string };
        id = created.id;
      }
      const tx = data.transactions.find((t) => t.id === id);
      const amount = tx ? tx.amount : decimal(paidCents);
      const parts = receiptParts(items.map((i) => ({ ...i, amount: clean(i.amount) })), amount);
      if (!parts.length) throw new Error('Confira os valores dos itens.');
      if (parts.length === 1) await act('movement.categorize', { id, category: parts[0].category }, 'Categoria da compra atualizada.');
      else await act('movement.split', { id, parts }, `Compra dividida em ${parts.length} categorias.`);
      reset(); setInfo('Nota aplicada. A imagem e o texto não foram guardados.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const set = (i: number, c: Partial<ReceiptItem>) => setItems((cur) => cur.map((x, k) => (k === i ? { ...x, ...c } : x)));
  return (
    <section className="panel receipt-import">
      <div className="panel-heading"><div><h2><ReceiptText size={18} /> Nota de mercado</h2><p>Divide uma compra em categorias: comida, limpeza, casa…</p></div></div>
      <div className="padded-form">
        <Hint short="Lida no seu aparelho. A imagem não é guardada.">Foto ou PDF do cupom (NFC-e), ou o texto colado. Os itens recebem categoria pelo produto e o app aprende com as suas correções. O desconto é repartido entre os itens e a soma fecha com o valor pago.</Hint>
        {!items.length ? (
          <div className="form-grid">
            <label className="field"><span>Foto ou PDF da nota</span><input type="file" accept="image/*,application/pdf,.txt" disabled={busy} onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} /></label>
            <label className="field"><span>Ou cole o texto</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="ARROZ 5KG 1 UN X 25,90 25,90" /><button type="button" className="text-button" disabled={!text.trim()} onClick={() => { try { load(text); setError(''); } catch (e) { setError((e as Error).message); } }}>Ler texto</button></label>
          </div>
        ) : (
          <form onSubmit={submit} className="receipt-review">
            <div className="form-grid">
              <label className="field"><span>Loja</span><input value={store} maxLength={80} onChange={(e) => setStore(e.target.value)} /></label>
              <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="field"><span>Valor pago (R$)</span><input inputMode="decimal" required value={paid} onChange={(e) => setPaid(e.target.value)} /><small>Soma dos itens: {brl(decimal(gross))}</small></label>
              <label className="field"><span>Compra a dividir</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} required>
                  {matches.map((t) => <option key={t.id} value={t.id}>{t.description} · {fmt(t.date)} · {brl(t.amount)}</option>)}
                  <option value="new">Registrar nova compra…</option>
                </select>
              </label>
              {target === 'new' && <label className="field"><span>Conta ou cartão</span><select value={account} onChange={(e) => setAccount(e.target.value)} required><option value="">Selecione</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>}
            </div>
            {items.map((it, i) => (
              <div className="receipt-row" key={it.key}>
                <span>{it.description}</span>
                <input inputMode="decimal" aria-label="Valor" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                <input list="category-list" aria-label="Categoria" autoComplete="off" value={it.category} onChange={(e) => set(i, { category: e.target.value })} />
                <button type="button" className="icon-button" aria-label={`Remover ${it.description}`} onClick={() => setItems((cur) => cur.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="row-actions">
              <button className="button primary" disabled={busy || paidCents <= 0n}><Check size={16} /> Dividir compra</button>
              <button type="button" className="button" onClick={reset}><X size={16} /> Descartar</button>
            </div>
          </form>
        )}
        {info && <p role="status" className="page-footnote">{info}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
