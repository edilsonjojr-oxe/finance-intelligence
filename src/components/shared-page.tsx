'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Camera, Check, Copy, Download, Link2, Lock, Pencil, Plus, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { FinanceState, SharedExpense, SharedGroup } from '@/lib/types';
import { brl, cents, decimal } from '@/lib/money';
import { computeSplit, type SplitMode } from '@/lib/split';
import { parseReceipt } from '@/lib/receipt';
import { accountLabel } from './card-fields';
import { isLiquid } from '@/lib/finance';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
const clean = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
const fmt = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const modes: [SplitMode, string][] = [['equal', 'Igual'], ['selected', 'Só alguns'], ['exact', 'Valores'], ['percent', '%']];
const kinds: Record<string, string> = { home: 'Casa', trip: 'Viagem', event: 'Evento', other: 'Outro' };
const INVITE_KEY = 'fi_group_invite';

/** Link de convite guardado até a pessoa entrar (o token fica no fragmento #, não vai ao servidor na URL). */
export function readGroupInvite() {
  try {
    const m = window.location.hash.match(/^#convite=([A-Za-z0-9_-]{20,64})$/);
    if (m) {
      sessionStorage.setItem(INVITE_KEY, m[1]);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return m[1];
    }
    return sessionStorage.getItem(INVITE_KEY) || '';
  } catch { return ''; }
}
export function clearGroupInvite() { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* sem armazenamento */ } }
export type InvitePreview = { group_name: string; kind: string; inviter: string; guests: { id: string; name: string }[] };
export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'group_preview', token }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Convite inválido.');
  return data;
}

/** Cartão "Entrar no grupo" para quem já está logado e abriu um link de convite. */
export function JoinGroupCard({ token, act, onDone }: { token: string; act: Act; onDone: () => void }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null), [error, setError] = useState(''), [claim, setClaim] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { fetchInvitePreview(token).then(setPreview).catch((e) => setError(e.message)); }, [token]);
  const close = () => { clearGroupInvite(); onDone(); };
  return (
    <section className="panel padded-form join-card">
      <h2><Users size={16} /> Convite para grupo</h2>
      {error ? <p className="error">{error}</p> : !preview ? <p>Verificando o convite…</p> : (
        <>
          <p><strong>{preview.inviter}</strong> convidou você para <strong>{preview.group_name}</strong> ({kinds[preview.kind] || preview.kind}).</p>
          {preview.guests.length > 0 && (
            <label className="field"><span>Você já está no grupo com outro nome?</span>
              <select value={claim} onChange={(e) => setClaim(e.target.value)}><option value="">Não, entrar como eu</option>{preview.guests.map((g) => <option key={g.id} value={g.id}>Sou {g.name}</option>)}</select>
            </label>
          )}
          <div className="row-actions">
            <button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try { await act('invite.join', { token, claim_member_id: claim || undefined }, `Você entrou em ${preview.group_name}.`); close(); } catch { setBusy(false); } }}><Check size={15} /> Entrar no grupo</button>
            <button className="button" onClick={close}><X size={15} /> Agora não</button>
          </div>
        </>
      )}
      {error && <div className="row-actions"><button className="button" onClick={close}>Fechar</button></div>}
    </section>
  );
}

function ExpenseForm({ group, data, act, edit, onDone }: { group: SharedGroup; data: FinanceState; act: Act; edit?: SharedExpense; onDone: () => void }) {
  const active = group.members.filter((m) => !m.removed);
  const ids = active.map((m) => m.id);
  const [description, setDescription] = useState(edit?.description || ''), [total, setTotal] = useState(edit ? edit.total.replace('.', ',') : '');
  const [date, setDate] = useState(edit?.date || data.today), [category, setCategory] = useState(edit?.category || '');
  const [payer, setPayer] = useState(edit?.payer_member_id || group.my_member_id), [mode, setMode] = useState<SplitMode>(edit ? 'exact' : 'equal');
  const [selected, setSelected] = useState<string[]>(ids), [values, setValues] = useState<Record<string, string>>(edit ? Object.fromEntries(Object.entries(edit.shares).map(([k, v]) => [k, v.replace('.', ',')])) : {});
  const [account, setAccount] = useState(group.auto_account_id || ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  const preview = computeSplit({ total: clean(total), mode, members: ids, selected, exact: values, percent: values });
  const askAccount = payer === group.my_member_id && !group.skip_ledger && !edit;
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
      const body = { description, total: clean(total), date, category, payer_member_id: payer, mode, selected, exact: v, percent: v, account_id: askAccount && account ? account : undefined };
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
        {askAccount && <label className="field"><span>Saiu de qual conta</span><select required value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Selecione</option>{data.accounts.filter(isLiquid).concat(data.accounts.filter((a) => a.type === 'credit_card')).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>}
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

function csvCell(v: string) { const safe = /^[=+@\t\r-]/.test(v) ? `'${v}` : v; return `"${safe.replace(/"/g, '""')}"`; }
/** CSV de fechamento: despesas com a parte de cada um, acertos, saldos e quem paga quem. */
function downloadCSV(group: SharedGroup) {
  const people = group.members.filter((m) => !m.removed || group.expenses.some((e) => cents(e.shares[m.id] || '0') > 0n));
  const name = (id: string) => group.members.find((m) => m.id === id)?.name || '—';
  const n = (v: string) => v.replace('.', ',');
  const rows: string[][] = [['data', 'descricao', 'categoria', 'total', 'pagou', ...people.map((p) => p.name)]];
  for (const e of [...group.expenses].reverse()) rows.push([e.date, e.description, e.category, n(e.total), name(e.payer_member_id), ...people.map((p) => n(e.shares[p.id] || '0.00'))]);
  rows.push([], ['acertos'], ['data', 'de', 'para', 'valor', 'situacao']);
  for (const s of group.settlements) rows.push([s.date, name(s.from_member_id), name(s.to_member_id), n(s.amount), s.status === 'confirmed' ? 'confirmado' : s.status === 'pending' ? 'pendente' : 'recusado']);
  rows.push([], ['saldo final (positivo = a receber)'], ...people.map((p) => [p.name, n(group.balances[p.id] || '0.00')]));
  rows.push([], ['para quitar tudo'], ...group.suggestions.map((s) => [name(s.from), 'paga a', name(s.to), n(s.amount)]));
  const blob = new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `grupo-${group.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function InvitePanel({ group, act }: { group: SharedGroup; act: Act }) {
  const [days, setDays] = useState(7), [uses, setUses] = useState(10), [link, setLink] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  async function create() {
    setBusy(true);
    try { const r = await act('invite.create', { group_id: group.id, days, max_uses: uses }, 'Link criado. Envie para quem vai participar.') as { token: string }; setLink(`${window.location.origin}/#convite=${r.token}`); setCopied(false); }
    catch { /* erro exibido pelo app */ } finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }
  async function share() { try { await navigator.share({ title: `Grupo ${group.name}`, text: `Entre no grupo "${group.name}" para dividirmos as despesas:`, url: link }); } catch { /* cancelado */ } }
  return (
    <div className="invite-box">
      <div className="inline-form">
        <select aria-label="Validade" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>Vale 1 dia</option><option value={7}>Vale 7 dias</option><option value={30}>Vale 30 dias</option></select>
        <select aria-label="Usos" value={uses} onChange={(e) => setUses(Number(e.target.value))}><option value={1}>1 pessoa</option><option value={5}>até 5</option><option value={10}>até 10</option><option value={50}>até 50</option></select>
        <button type="button" className="button" disabled={busy} onClick={create}><Link2 size={15} /> Criar link</button>
      </div>
      {link && (
        <div className="confirm-row">
          <span className="invite-link">{link}</span>
          <button type="button" className="button" onClick={copy}><Copy size={14} /> {copied ? 'Copiado' : 'Copiar'}</button>
          {typeof navigator !== 'undefined' && 'share' in navigator && <button type="button" className="button" onClick={share}><Share2 size={14} /> Enviar</button>}
        </div>
      )}
      {link && <p className="page-footnote">O link aparece só agora. Quem não usa o app cria uma conta só para dividir.</p>}
      {group.invites.length > 0 && (
        <ul className="parcel-list">
          {group.invites.map((i) => <li key={i.id}><span>Link ativo até {fmt(i.expires_at)}</span><span>{i.uses} de {i.max_uses} usos</span><span className="parcel-actions"><button type="button" className="text-button" onClick={() => act('invite.revoke', { id: i.id }, 'Link revogado.').catch(() => {})}>Revogar</button></span></li>)}
        </ul>
      )}
    </div>
  );
}

function SettleRow({ group, data, act, from, to, amount, pending }: { group: SharedGroup; data: FinanceState; act: Act; from: string; to: string; amount: string; pending: boolean }) {
  const [value, setValue] = useState(amount.replace('.', ',')), [account, setAccount] = useState(''), [busy, setBusy] = useState(false);
  const iPay = from === group.my_member_id;
  const name = (id: string) => group.members.find((m) => m.id === id)?.name || '—';
  const guestPays = !iPay && to === group.my_member_id && group.members.find((m) => m.id === from)?.guest;
  const liquid = data.accounts.filter(isLiquid);
  const needsAccount = !group.skip_ledger;
  async function run() {
    setBusy(true);
    try {
      if (iPay) await act('settle.pay', { group_id: group.id, to_member_id: to, amount: clean(value), account_id: account || undefined, date: data.today }, group.members.find((m) => m.id === to)?.guest ? 'Pagamento registrado.' : 'Pagamento registrado. Aguardando confirmação de quem recebeu.');
      else await act('settle.receive', { group_id: group.id, from_member_id: from, amount: clean(value), account_id: account || undefined, date: data.today }, 'Recebimento registrado.');
    } catch { /* erro exibido pelo app */ } finally { setBusy(false); }
  }
  return (
    <li className="settle-row">
      <span>{iPay ? 'Você' : name(from)} → {to === group.my_member_id ? 'você' : name(to)}</span>
      <strong>{brl(amount)}</strong>
      {pending ? <small>aguardando confirmação</small> : (iPay || guestPays) && (
        <span className="settle-actions">
          <input aria-label="Valor" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          {needsAccount && <select aria-label={iPay ? 'Saiu de' : 'Entrou em'} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">{iPay ? 'Saiu de…' : 'Entrou em…'}</option>{liquid.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>}
          <button type="button" className="button" disabled={busy || (needsAccount && !account)} onClick={run}>{iPay ? 'Paguei' : 'Recebi'}</button>
        </span>
      )}
    </li>
  );
}

function GroupCard({ group, data, act }: { group: SharedGroup; data: FinanceState; act: Act }) {
  const [form, setForm] = useState<'new' | SharedExpense | null>(null), [busy, setBusy] = useState(false);
  const [payAccount, setPayAccount] = useState(''), [guest, setGuest] = useState(''), [editing, setEditing] = useState(false);
  const name = (id: string) => { const m = group.members.find((x) => x.id === id); return m?.me ? 'Você' : m?.name || '—'; };
  const myBal = cents(group.balances[group.my_member_id] || '0');
  const toConfirm = group.settlements.filter((s) => s.status === 'pending' && s.to_member_id === group.my_member_id);
  const waiting = group.settlements.filter((s) => s.status === 'pending' && s.from_member_id === group.my_member_id);
  const liquid = data.accounts.filter(isLiquid);
  const active = group.status === 'active';
  const fullPlan = data.shared.plan === 'full';
  async function run(action: string, payload: unknown, message: string) { setBusy(true); try { await act(action, payload, message); } catch { /* erro exibido pelo app */ } finally { setBusy(false); } }
  function saveGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    run('group.update', { group_id: group.id, name: fd.get('name'), starts_on: fd.get('starts_on') || '', ends_on: fd.get('ends_on') || '' }, 'Grupo atualizado.').then(() => setEditing(false));
  }
  return (
    <section className="panel group-card">
      <div className="loan-head">
        <div>
          <h2><Users size={16} /> {group.name} <span className="badge">{kinds[group.kind] || group.kind}</span>{!active && <span className="badge orange"><Lock size={10} /> {group.status === 'closed' ? 'encerrado' : 'arquivado'}</span>}</h2>
          <p>{group.members.filter((m) => !m.removed).map((m) => (m.me ? 'Você' : m.guest ? `${m.name} (sem conta)` : m.name)).join(', ')}</p>
          {(group.starts_on || group.ends_on) && <p className="page-footnote">{group.starts_on ? fmt(group.starts_on) : '…'} a {group.ends_on ? fmt(group.ends_on) : '…'}</p>}
        </div>
        <div className="loan-amount"><strong className={myBal < 0n ? 'negative' : ''}>{brl(decimal(myBal < 0n ? -myBal : myBal))}</strong><small>{myBal > 0n ? 'a receber' : myBal < 0n ? 'você deve' : 'tudo certo'}</small></div>
      </div>
      {group.suggestions.length > 0 && (
        <div>
          <h3 className="mini-title">Para quitar tudo</h3>
          <ul className="parcel-list">{group.suggestions.map((s) => <SettleRow key={`${s.from}-${s.to}-${s.amount}`} group={group} data={data} act={act} {...s} pending={group.settlements.some((x) => x.status === 'pending' && x.from_member_id === s.from && x.to_member_id === s.to)} />)}</ul>
        </div>
      )}
      {toConfirm.map((s) => (
        <div key={s.id} className="confirm-row">
          <span>{name(s.from_member_id)} diz que pagou {brl(s.amount)} ({fmt(s.date)})</span>
          {!group.skip_ledger && <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)} aria-label="Conta onde entrou"><option value="">Entrou em…</option>{liquid.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>}
          <button className="button" disabled={busy || (!group.skip_ledger && !payAccount)} onClick={() => run('settle.confirm', { id: s.id, account_id: payAccount || undefined }, 'Recebimento confirmado.')}>Confirmar</button>
          <button className="text-button" disabled={busy} onClick={() => run('settle.reject', { id: s.id }, 'Acerto recusado.')}>Não recebi</button>
        </div>
      ))}
      {waiting.map((s) => <p key={s.id} className="page-footnote">Aguardando {name(s.to_member_id)} confirmar {brl(s.amount)}.</p>)}
      {form ? <ExpenseForm group={group} data={data} act={act} edit={form === 'new' ? undefined : form} onDone={() => setForm(null)} />
        : <div className="row-actions">
            <button className="button primary" disabled={!active} onClick={() => setForm('new')}><Plus size={15} /> Nova despesa</button>
            <button className="button" onClick={() => downloadCSV(group)}><Download size={15} /> CSV</button>
          </div>}
      <details>
        <summary>Despesas ({group.expenses.length})</summary>
        <ul className="parcel-list">
          {group.expenses.map((e) => (
            <li key={e.id}>
              <span>{e.description}<small> · {fmt(e.date)}</small></span>
              <span>{brl(e.total)}<small> · pagou {name(e.payer_member_id)}</small></span>
              <span>sua parte {brl(e.shares[group.my_member_id] || '0')}</span>
              <span className="parcel-actions">{e.mine && active && <>
                <button type="button" className="text-button" aria-label={`Editar ${e.description}`} onClick={() => setForm(e)}><Pencil size={12} /></button>
                <button type="button" className="text-button" aria-label={`Excluir ${e.description}`} disabled={busy} onClick={() => confirm(`Excluir "${e.description}"? As partes em aberto dos outros serão canceladas.`) && run('shared.delete', { id: e.id }, 'Despesa excluída.')}><Trash2 size={12} /></button>
              </>}</span>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Pessoas e convites</summary>
        <ul className="parcel-list">
          {group.members.filter((m) => !m.removed).map((m) => (
            <li key={m.id}><span>{m.me ? 'Você' : m.name}</span><span>{m.role === 'owner' ? 'criou o grupo' : m.guest ? 'sem conta' : 'membro'}</span>
              <span className="parcel-actions">{group.owner && m.guest && <button type="button" className="text-button" aria-label={`Remover ${m.name}`} disabled={busy} onClick={() => run('group.remove_guest', { group_id: group.id, member_id: m.id }, 'Pessoa removida.')}><X size={12} /></button>}</span></li>
          ))}
        </ul>
        {active && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run('group.add_guest', { group_id: group.id, name: guest }, 'Pessoa incluída.').then(() => setGuest('')); }}>
            <input value={guest} onChange={(e) => setGuest(e.target.value)} required maxLength={80} placeholder="Nome de quem não usa o app" />
            <button className="button" disabled={busy}><UserPlus size={15} /> Incluir</button>
          </form>
        )}
        {group.owner && active && <InvitePanel group={group} act={act} />}
      </details>
      <details>
        <summary>Atividade</summary>
        <ul className="feed">{group.feed.map((f, i) => <li key={i}><small>{fmt(f.at)} {f.at.slice(11, 16)}</small> {f.text}</li>)}</ul>
      </details>
      <details>
        <summary>Configurações do grupo</summary>
        {fullPlan && <label className="checkbox-label"><input type="checkbox" checked={group.skip_ledger} onChange={(e) => run('group.settings', { group_id: group.id, auto_post: group.auto_post, auto_account_id: group.auto_account_id || '', skip_ledger: e.target.checked }, 'Preferência salva.')} /> Não lançar este grupo nas minhas finanças (só controlar a divisão)</label>}
        {fullPlan && !group.skip_ledger && <>
          <label className="checkbox-label"><input type="checkbox" checked={group.auto_post} onChange={(e) => run('group.settings', { group_id: group.id, auto_post: e.target.checked, auto_account_id: group.auto_account_id || '' }, 'Preferência salva.')} /> Lançar minhas partes automaticamente nas minhas finanças</label>
          <label className="field"><span>Conta padrão quando eu pagar</span><select value={group.auto_account_id || ''} onChange={(e) => run('group.settings', { group_id: group.id, auto_post: group.auto_post, auto_account_id: e.target.value }, 'Conta padrão salva.')}><option value="">Perguntar sempre</option>{data.accounts.filter((a) => a.type !== 'receivable').map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>
        </>}
        {group.owner && (editing ? (
          <form onSubmit={saveGroup} className="shared-form">
            <div className="form-grid">
              <label className="field"><span>Nome</span><input name="name" required maxLength={80} defaultValue={group.name} /></label>
              <label className="field"><span>Início</span><input name="starts_on" type="date" defaultValue={group.starts_on || ''} /></label>
              <label className="field"><span>Fim</span><input name="ends_on" type="date" defaultValue={group.ends_on || ''} /></label>
            </div>
            <div className="row-actions"><button className="button primary" disabled={busy}>Salvar</button><button type="button" className="button" onClick={() => setEditing(false)}>Cancelar</button></div>
          </form>
        ) : (
          <div className="row-actions">
            <button type="button" className="button" onClick={() => setEditing(true)}><Pencil size={14} /> Editar</button>
            {active && <button type="button" className="button" disabled={busy} onClick={() => confirm('Encerrar o grupo? Ninguém poderá lançar novas despesas; os acertos continuam.') && run('group.close', { group_id: group.id }, 'Grupo encerrado.')}><Lock size={14} /> Encerrar</button>}
            {group.status === 'closed' && <button type="button" className="button" disabled={busy} onClick={() => run('group.reopen', { group_id: group.id }, 'Grupo reaberto.')}>Reabrir</button>}
            {group.status === 'closed' && <button type="button" className="button" disabled={busy} onClick={() => run('group.archive', { group_id: group.id }, 'Grupo arquivado.')}>Arquivar</button>}
          </div>
        ))}
        {!group.owner && <button type="button" className="text-button" disabled={busy} onClick={() => confirm('Sair do grupo? Você deixa de ver as despesas dele.') && run('group.leave', { group_id: group.id }, 'Você saiu do grupo.')}>Sair do grupo</button>}
      </details>
    </section>
  );
}

export default function SharedPage({ data, act }: { data: FinanceState; act: Act }) {
  const s = data.shared;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [creating, setCreating] = useState(false), [kind, setKind] = useState('home');
  const [postAccount, setPostAccount] = useState<Record<string, string>>({});
  const connected = useMemo(() => s.connections.filter((c) => c.status === 'accepted'), [s.connections]);
  const live = s.groups.filter((g) => g.status !== 'archived'), archived = s.groups.filter((g) => g.status === 'archived');
  async function run(action: string, payload: unknown, msg: string) { setBusy(true); try { const r = await act(action, payload, msg) as { message?: string }; if (r?.message) setMessage(r.message); } catch { /* erro exibido pelo app */ } finally { setBusy(false); } }
  function request(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = e.currentTarget; run('connect.request', { email: new FormData(f).get('email') }, 'Pedido processado.').then(() => f.reset()); }
  function createGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const guests = String(fd.get('guests') || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    run('group.create', { name: fd.get('name'), kind: fd.get('kind'), member_user_ids: fd.getAll('member'), guest_names: guests, starts_on: fd.get('starts_on') || '', ends_on: fd.get('ends_on') || '' }, 'Grupo criado. Convide as pessoas em "Pessoas e convites".').then(() => setCreating(false));
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
              <button className="text-button" disabled={busy} onClick={() => run('shared.skip', { expense_id: i.expense_id }, 'Parte marcada para não lançar.')}>Não lançar</button>
            </div>
          ))}
          {s.notices.map((n) => <div key={n.expense_id} className="confirm-row notice"><span>{n.notice}</span><button className="text-button" onClick={() => run('shared.dismiss_notice', { expense_id: n.expense_id }, 'Aviso dispensado.')}><X size={13} /></button></div>)}
        </section>
      )}
      {live.map((g) => <GroupCard key={g.id} group={g} data={data} act={act} />)}
      <section className="panel padded-form">
        {creating ? (
          <form onSubmit={createGroup} className="shared-form">
            <h2><Users size={16} /> Novo grupo</h2>
            <div className="form-grid">
              <label className="field"><span>Nome do grupo</span><input name="name" required maxLength={80} placeholder="Ex.: Viagem para a praia" /></label>
              <label className="field"><span>Tipo</span><select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="home">Casa</option><option value="trip">Viagem</option><option value="event">Evento</option><option value="other">Outro</option></select></label>
              {kind !== 'home' && <><label className="field"><span>Início</span><input name="starts_on" type="date" /></label><label className="field"><span>Fim</span><input name="ends_on" type="date" /></label></>}
            </div>
            {connected.length > 0 && <div className="split-people">{connected.map((c) => <label key={c.user_id} className="split-person"><input type="checkbox" name="member" value={c.user_id} /><span>{c.name}</span></label>)}</div>}
            <label className="field"><span>Pessoas sem conta (opcional, separadas por vírgula)</span><input name="guests" maxLength={800} placeholder="Ex.: João, Maria" /></label>
            <p className="page-footnote">Depois de criar, você pode gerar um link para os outros entrarem.</p>
            <div className="row-actions"><button className="button primary" disabled={busy}>Criar grupo</button><button type="button" className="button" onClick={() => setCreating(false)}>Cancelar</button></div>
          </form>
        ) : <div className="row-actions"><button className="button primary" onClick={() => setCreating(true)}><Plus size={15} /> Novo grupo</button></div>}
      </section>
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
      </section>
      {archived.length > 0 && (
        <details className="panel padded-form">
          <summary>Grupos arquivados ({archived.length})</summary>
          {archived.map((g) => <GroupCard key={g.id} group={g} data={data} act={act} />)}
        </details>
      )}
    </div>
  );
}
