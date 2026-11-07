'use client';
import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { defaultCategories } from '@/lib/categorize';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;

/** Categorias prontas (fixas) e personalizadas (criadas e removidas pelo usuário). */
export default function CategoryPanel({ custom, act }: { custom: string[]; act: Act }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
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
      <p>
        O sistema sugere a categoria de cada gasto (por exemplo, iFood → Alimentação, Netflix →
        Assinaturas) e aprende com as suas correções: da próxima vez, o mesmo estabelecimento
        recebe a categoria que você escolheu.
      </p>
      <form onSubmit={add} className="category-add">
        <label className="field">
          <span>Nova categoria</span>
          <input name="name" maxLength={80} required placeholder="Ex.: Escola das crianças" disabled={busy} />
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
        <summary>Ver categorias prontas ({defaultCategories.length})</summary>
        <ul className="chip-list muted">
          {defaultCategories.map((c) => <li key={c} className="chip">{c}</li>)}
        </ul>
      </details>
    </section>
  );
}
