'use client';
import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { categoryGroup, categoryTree, SEPARATOR } from '@/lib/categorize';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
const NEW_GROUP = '__novo__';

/** Grupos e subcategorias prontos (fixos) e personalizados (criados e removidos pelo usuário). */
export default function CategoryPanel({ custom, act }: { custom: string[]; act: Act }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [group, setGroup] = useState('Alimentação');
  const groups = [...new Set([...Object.keys(categoryTree), ...custom.map(categoryGroup)])];
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const sub = String(fd.get('sub') || '').trim();
    const chosen = group === NEW_GROUP ? String(fd.get('new_group') || '').trim() : group;
    if (!chosen) return setError('Informe o grupo.');
    const name = sub ? `${chosen}${SEPARATOR}${sub}` : chosen;
    setBusy(true); setError('');
    try { await act('category.create', { name }, `Categoria "${name}" criada.`); form.reset(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(name: string) {
    setBusy(true); setError('');
    try { await act('category.delete', { name }, `Categoria "${name}" removida da lista. Lançamentos antigos mantêm o nome.`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel settings-card">
      <h2>Categorias</h2>
      <p>Grupo e subcategoria, como <em>Alimentação / Delivery</em>. O app sugere e aprende com as suas correções.</p>
      <form onSubmit={add} className="category-add">
        <label className="field">
          <span>Grupo</span>
          <select value={group} onChange={(e) => setGroup(e.target.value)} disabled={busy}>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value={NEW_GROUP}>Novo grupo…</option>
          </select>
        </label>
        {group === NEW_GROUP && (
          <label className="field">
            <span>Nome do grupo</span>
            <input name="new_group" maxLength={40} required placeholder="Ex.: Filhos" disabled={busy} />
          </label>
        )}
        <label className="field">
          <span>Subcategoria</span>
          <input name="sub" maxLength={38} placeholder="Ex.: Lanche do trabalho" disabled={busy} />
        </label>
        <button className="button" disabled={busy}>Adicionar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {custom.length > 0 && (
        <>
          <span className="eyebrow">SUAS CATEGORIAS</span>
          <ul className="chip-list">
            {custom.map((c) => (
              <li key={c} className="chip">
                {c}
                <button type="button" aria-label={`Remover ${c}`} disabled={busy} onClick={() => remove(c)}><X size={13} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Ver categorias prontas</summary>
        <dl className="category-tree">
          {Object.entries(categoryTree).map(([g, subs]) => (
            <div key={g}>
              <dt>{g}</dt>
              <dd>{subs.length ? subs.join(' · ') : '—'}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
