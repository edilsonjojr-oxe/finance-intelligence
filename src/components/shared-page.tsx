'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { Camera, Check, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { FinanceState, SharedExpense, SharedGroup } from '@/lib/types';
import { brl, cents, decimal } from '@/lib/money';
import { computeSplit, type SplitMode } from '@/lib/split';
import { parseReceipt } from '@/lib/receipt';
import { accountLabel } from './card-fields';
import { isLiquid } from '@/lib/finance';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
const clean = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
const fmt = (d: string) => d.split('-').reverse().join('/');
const modes: [SplitMode, string][] = [['equal', 'Igual'], ['selected', 'Só alguns'], ['exact', 'Valores'], ['percent', '%']];

function ExpenseForm({ group, data, act, edit, onDone }: { group: SharedGroup; data: FinanceState; act: Act; edit?: SharedExpense; onDone: () => void }) {
  const active = group.members.filter((m) => !m.removed);
  const ids = active.map((m) => m.id);
  const [description, setDescription] = useState(edit?.description || ''), [total, setTotal] = useState(edit ? edit.total.replace('.', ',') : '');
  const [date, setDate] = useState(edit?.date || data.today), [category, setCategory] = useState(edit?.category || '');
  const [payer, setPayer] = useState(edit?.payer_member_id || group.my_member_id), [mode, setMode] = useState<SplitMode>(edit ? 'exact' : 'equal');
  const [selected, setSelected] = useState<string[]>(ids), [values, setValues] = useState<Record<string, string>>(edit ? Object.fromEntries(Object.entries(edit.shares).map(([k, v]) => [k, v.replace('.', ',')])) : {});
  const [account, setAccount] = useState(group.auto_account_id || ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  const preview = computeSplit({ total: clean(total), mode, members: ids, selected, exact: values, percent: values });
  async function readReceipt(file: File) {
    setBusy(true); setError(''); setInfo('Lendo no seu aparelho…');
    try {
      const reader = await import('@/lib/document-reader');
      const r = await reader.readDocument(file, setInfo);
      const p = parseReceipt(r.text); r.text = '';
      if (p.total) setTotal(p.total.replace('.', ','));
      if (p.date && p.date <= data.today) setDate(p.date);
      if (p.store && !description) setDescription(p.store);
      setInfo(p.total ? 'Comprovante lido. Confira antes de salvar; o arquivo não é guardado.' : 'Não encontrei o total; preencha manualmente.');
    } catch (e) { setError((e as Error).message); setInfo(''); }
    finally { setBusy(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!preview.ok) return setError(preview.error);
    setBusy(true); setError('');
    const v = Object.fromEntries(Object.entries(values).map(([k, x]) => [k, clean(x)]));
    try {
      const body = { description, total: clean(total), date, category, payer_member_id: payer, mode, selected, exact: v, percent: v, account_id: payer === group.my_member_id && account ? account : undefined };
      await act(edit ? 'shared.update' : 'shared.create', edit ? { ...body, id: edit.id } : { ...body, group_id: group.id }, edit ? 'Despesa atualizada.' : 'Despesa dividida.');
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="shared-form">
      <div className="form-grid">
        <label className="field"><span>Descrição</span><input required maxLength={160} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aluguel" /></label>
        <label className="field"><span>Total (R$)</span><input required inputMode="decimal" pattern="[0-9.,]+" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
        <label className="field"><span>Data</span><input type="date" required max={data.today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Categoria</span><input list="category-list" autoComplete="off" maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} /></label>
        <label className="field"><span>Quem pagou</span><select value={payer} onChange={(e) => setPayer(e.target.value)}>{active.map((m) => <option key={m.id} value={m.id}>{m.me ? 'Eu' : m.name}</option>)}</select></label>
        {payer === group.my_member_id && <label className="field"><span>Saiu de qual conta</span><select required value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Selecione</option>{data.accounts.filter(isLiquid).concat(data.accounts.filter((a) => a.type === 'credit_card')).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>}
      </div>
      {!edit && <label className="field"><span><Camera size={14} /> Ler comprovante (opcional)</span><input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && readReceipt(e.target.files[0])} /></label>}
      <div className="auth-switch four" role="tablist" aria-label="Divisão">
        {modes.map(([m, label]) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{label}</button>)}
      </div>
      <div className="split-people">
        {active.map((m) => (
          <label key={m.id} className="split-person">
            {mode === 'selected' && <input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => setSelected((cur) => e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id))} />}
            <span>{m.me ? 'Eu' : m.name}</span>
            {(mode === 'exact' || mode === 'percent') && <input inputMode="decimal" aria-label={`${mode === 'percent' ? '%' : 'Valor'} de ${m.name}`} value={values[m.id] || ''} onChange={(e) => setValues((cur) => ({ ...cur, [m.id]: e.target.value }))} placeholder={mode === 'percent' ? '%' : '0,00'} />}
            <strong>{preview.ok ? brl(preview.shares[m.id]) : ''}</strong>
          </label>
        ))}
      </div>
      {!preview.ok && total && <p className="split-summary"><span className="pending">{preview.error}</span></p>}
      {info && <p role="status" className="page-footnote">{info}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row-actions">
        <button className="button primary" disabled={busy || !preview.ok}><Check size={16} /> {edit ? 'Salvar alteração' : 'Dividir'}</button>
        <button type="button" className="button" onClick={onDone}><X size={16} /> Cancelar</button>
      </div>
    </form>
  );
}

function GroupCard({ group, data, act }: { group: SharedGroup; data: FinanceState; act: Act }) {
  const [form, setForm] = useState<'new' | SharedExpense | null>(null), [busy, setBusy] = useState(false);
  const [payAccount, setPayAccount] = useState(''), [payTo, setPayTo] = useState('');
  const name = (id: string) => { const m = group.members.find((x) => x.id === id); return m?.me ? 'Você' : m?.name || '—'; };
  const myBal = cents(group.balances[group.my_member_id] || '0');
  const owes = group.members.filter((m) => !m.me && cents(group.balances[m.id] || '0') > 0n);
  const toConfirm = group.settlements.filter((s) => s.status === 'pending' && s.to_member_id === group.my_member_id);
  const liquid = data.accounts.filter(isLiquid);
  async function run(action: string, payload: unknown, message: string) { setBusy(true); try { await act(action, payload, message); } catch { /* erro exibido pelo app */ } finally { setBusy(false); } }
  return (
    <section className="panel group-card">
      <div className="loan-head">
        <div><h2><Users size={16} /> {group.name}</h2><p>{group.members.filter((m) => !m.removed).map((m) => (m.me ? 'Você' : m.name)).join(', ')}</p></div>
        <div className="loan-amount"><strong className={myBal < 0n ? 'negative' : ''}>{brl(decimal(myBal < 0n ? -myBal : myBal))}</strong><small>{myBal > 0n ? 'a receber' : myBal < 0n ? 'você deve' : 'tudo certo'}</small></div>
      </div>
      <ul className="parcel-list">
        {group.members.filter((m) => !m.me).map((m) => { const b = cents(group.balances[m.id] || '0'); return <li key={m.id}><span>{m.name}</span><span>{b === 0n ? 'quite' : b > 0n ? `a receber ${brl(decimal(b))}` : `deve ${brl(decimal(-b))}`}</span></li>; })}
      </ul>
      {toConfirm.map((s) => (
        <div key={s.id} className="confirm-row">
          <span>{name(s.from_member_id)} diz que pagou {brl(s.amount)} ({fmt(s.date)})</span>
          <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)} aria-label="Conta onde entrou"><option value="">Entrou em…</option>{liquid.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>
          <button className="button" disabled={busy || !payAccount} onClick={() => run('settle.confirm', { id: s.id, account_id: payAccount }, 'Recebimento confirmado.')}>Confirmar</button>
          <button className="text-button" disabled={busy} onClick={() => run('settle.reject', { id: s.id }, 'Acerto recusado.')}>Não recebi</button>
        </div>
      ))}
      {myBal < 0n && owes.length > 0 && (
        <div className="confirm-row">
          <select value={payTo} onChange={(e) => setPayTo(e.target.value)} aria-label="Pagar para"><option value="">Pagar para…</option>{owes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)} aria-label="Saiu de"><option value="">Saiu de…</option>{liquid.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>
          <button className="button" disabled={busy || !payTo || !payAccount} onClick={() => run('settle.pay', { group_id: group.id, to_member_id: payTo, account_id: payAccount, date: data.today }, 'Pagamento registrado. Aguardando confirmação de quem recebeu.')}>Registrar pagamento</button>
        </div>
      )}
      {form ? <ExpenseForm group={group} data={data} act={act} edit={form === 'new' ? undefined : form} onDone={() => setForm(null)} />
        : <div className="row-actions"><button className="button primary" disabled={group.status !== 'active'} onClick={() => setForm('new')}><Plus size={15} /> Nova despesa</button></div>}
      <details>
        <summary>Despesas ({group.expenses.length})</summary>
        <ul className="parcel-list">
          {group.expenses.map((e) => (
            <li key={e.id}>
              <span>{e.description}<small> · {fmt(e.date)}</small></span>
              <span>{brl(e.total)}<small> · pagou {name(e.payer_member_id)}</small></span>
              <span>sua parte {brl(e.shares[group.my_member_id] || '0')}</span>
              <span className="parcel-actions">{e.mine && <>
                <button type="button" className="text-button" aria-label={`Editar ${e.description}`} onClick={() => setForm(e)}><Pencil size={12} /></button>
                <button type="button" className="text-button" aria-label={`Excluir ${e.description}`} disabled={busy} onClick={() => confirm(`Excluir "${e.description}"? As partes em aberto dos outros serão canceladas.`) && run('shared.delete', { id: e.id }, 'Despesa excluída.')}><Trash2 size={12} /></button>
              </>}</span>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Configurações do grupo</summary>
        <label className="checkbox-label"><input type="checkbox" checked={group.auto_post} onChange={(e) => run('group.settings', { group_id: group.id, auto_post: e.target.checked, auto_account_id: group.auto_account_id || '' }, 'Preferência salva.')} /> Lançar minhas partes automaticamente nas minhas finanças</label>
        <label className="field"><span>Conta padrão quando eu pagar</span><select value={group.auto_account_id || ''} onChange={(e) => run('group.settings', { group_id: group.id, auto_post: group.auto_post, auto_account_id: e.target.value }, 'Conta padrão salva.')}><option value="">Perguntar sempre</option>{data.accounts.filter((a) => a.type !== 'receivable').map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>
        <button type="button" className="text-button" disabled={busy} onClick={() => confirm('Sair do grupo? Você deixa de ver as despesas dele.') && run('group.leave', { group_id: group.id }, 'Você saiu do grupo.')}>Sair do grupo</button>
      </details>
    </section>
  );
}

export default function SharedPage({ data, act }: { data: FinanceState; act: Act }) {
  const s = data.shared;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [creating, setCreating] = useState(false);
  const [postAccount, setPostAccount] = useState<Record<string, string>>({});
  const connected = useMemo(() => s.connections.filter((c) => c.status === 'accepted'), [s.connections]);
  async function run(action: string, payload: unknown, msg: string) { setBusy(true); try { const r = await act(action, payload, msg) as { message?: string }; if (r?.message) setMessage(r.message); } catch { /* erro exibido pelo app */ } finally { setBusy(false); } }
  function request(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = e.currentTarget; run('connect.request', { email: new FormData(f).get('email') }, 'Pedido processado.').then(() => f.reset()); }
  function createGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    run('group.create', { name: fd.get('name'), kind: fd.get('kind'), member_user_ids: fd.getAll('member') }, 'Grupo criado.').then(() => setCreating(false));
  }
  return (
    <div className="reports">
      {(s.inbox.length > 0 || s.notices.length > 0) && (
        <section className="panel padded-form">
          <h2>Para lançar nas suas finanças ({s.inbox.length})</h2>
          {s.inbox.map((i) => (
            <div key={i.expense_id} className="confirm-row">
              <span><strong>{i.description}</strong> · {i.group_name} · {fmt(i.date)}<br /><small>{i.i_am_payer ? `Você pagou ${brl(i.total)}; sua parte ${brl(i.my_share)}` : `Sua parte ${brl(i.my_share)} · pagar para ${i.payer_name}`}</small></span>
              {i.i_am_payer && <select aria-label="Conta" value={postAccount[i.expense_id] || ''} onChange={(e) => setPostAccount((c) => ({ ...c, [i.expense_id]: e.target.value }))}><option value="">Saiu de…</option>{data.accounts.filter((a) => a.type !== 'receivable').map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>}
              <button className="button" disabled={busy || (i.i_am_payer && !postAccount[i.expense_id])} onClick={() => run('shared.post', { expense_id: i.expense_id, account_id: postAccount[i.expense_id] || undefined }, 'Lançado nas suas finanças.')}>Lançar</button>
            </div>
          ))}
          {s.notices.map((n) => <div key={n.expense_id} className="confirm-row notice"><span>{n.notice}</span><button className="text-button" onClick={() => run('shared.dismiss_notice', { expense_id: n.expense_id }, 'Aviso dispensado.')}><X size={13} /></button></div>)}
        </section>
      )}
      {s.groups.map((g) => <GroupCard key={g.id} group={g} data={data} act={act} />)}
      <section className="panel padded-form">
        <h2><UserPlus size={16} /> Conexões</h2>
        <form onSubmit={request} className="inline-form"><input name="email" type="email" required placeholder="E-mail de quem já usa o app" /><button className="button" disabled={busy}>Enviar pedido</button></form>
        {message && <p role="status" className="page-footnote">{message}</p>}
        <ul className="parcel-list">
          {s.connections.map((c) => (
            <li key={c.id}>
              <span>{c.name}<small> · {c.email}</small></span>
              <span>{c.status === 'accepted' ? 'conectado' : c.status === 'blocked' ? 'bloqueado' : c.incoming ? 'quer se conectar' : 'aguardando'}</span>
              <span className="parcel-actions">
                {c.incoming && <><button className="text-button" disabled={busy} onClick={() => run('connect.respond', { id: c.id, accept: true }, 'Conexão aceita.')}>Aceitar</button><button className="text-button" disabled={busy} onClick={() => run('connect.respond', { id: c.id, accept: false }, 'Pedido recusado.')}>Recusar</button></>}
                {c.status === 'accepted' && <button className="text-button" disabled={busy} onClick={() => run('connect.remove', { id: c.id }, 'Conexão removida.')}>Remover</button>}
                {c.status !== 'blocked' && <button className="text-button" disabled={busy} onClick={() => run('connect.block', { id: c.id }, 'Pessoa bloqueada.')}>Bloquear</button>}
              </span>
            </li>
          ))}
        </ul>
        {connected.length > 0 && (creating ? (
          <form onSubmit={createGroup} className="shared-form">
            <div className="form-grid">
              <label className="field"><span>Nome do grupo</span><input name="name" required maxLength={80} placeholder="Ex.: Casa" /></label>
              <label className="field"><span>Tipo</span><select name="kind" defaultValue="home"><option value="home">Casa</option><option value="trip">Viagem</option><option value="event">Evento</option><option value="other">Outro</option></select></label>
            </div>
            <div className="split-people">{connected.map((c) => <label key={c.user_id} className="split-person"><input type="checkbox" name="member" value={c.user_id} /><span>{c.name}</span></label>)}</div>
            <div className="row-actions"><button className="button primary" disabled={busy}>Criar grupo</button><button type="button" className="button" onClick={() => setCreating(false)}>Cancelar</button></div>
          </form>
        ) : <div className="row-actions"><button className="button" onClick={() => setCreating(true)}><Plus size={15} /> Novo grupo</button></div>)}
      </section>
    </div>
  );
}
