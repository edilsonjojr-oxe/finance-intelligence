'use client';
import { useState, type FormEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Movement, Split } from '@/lib/types';
import { brl, cents, decimal } from '@/lib/money';
import { DIVIDED, UNCATEGORIZED } from '@/lib/categorize';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
type Part = { category: string; amount: string; description: string };
const toCents = (v: string) => {
  try { return cents(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v || '0'); } catch { return null; }
};

/**
 * Categoria de um lançamento já confirmado: trocar por uma só ou dividir entre várias
 * (ex.: compra no mercado = comida + limpeza + cama, mesa e banho).
 */
export default function MovementCategoryEditor({ movement: t, splits, act, onClose }: {
  movement: Movement; splits: Split[]; act: Act; onClose: () => void;
}) {
  const [divide, setDivide] = useState(splits.length > 0);
  const [single, setSingle] = useState(t.category === DIVIDED ? UNCATEGORIZED : t.category);
  const [parts, setParts] = useState<Part[]>(
    splits.length
      ? splits.map((s) => ({ category: s.category, amount: s.amount.replace('.', ','), description: s.description }))
      : [{ category: t.category === DIVIDED ? UNCATEGORIZED : t.category, amount: t.amount.replace('.', ','), description: '' }, { category: UNCATEGORIZED, amount: '', description: '' }],
  );
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const total = cents(t.amount);
  const used = parts.reduce((n, p) => n + (toCents(p.amount) || 0n), 0n);
  const remaining = total - used;
  const set = (i: number, change: Partial<Part>) => setParts((cur) => cur.map((p, k) => (k === i ? { ...p, ...change } : p)));
  /** Coloca o que falta na parte indicada (útil para a última linha). */
  const fill = (i: number) => set(i, { amount: decimal((toCents(parts[i].amount) || 0n) + remaining).replace('.', ',') });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (!divide) await act('movement.categorize', { id: t.id, category: single }, 'Categoria atualizada. Próximos lançamentos parecidos seguirão esta escolha.');
      else {
        if (remaining !== 0n) throw new Error(remaining > 0n ? `Faltam ${brl(decimal(remaining))} para fechar o valor.` : `As partes passam ${brl(decimal(-remaining))} do valor.`);
        await act('movement.split', {
          id: t.id,
          parts: parts.filter((p) => toCents(p.amount)).map((p) => ({ ...p, amount: decimal(toCents(p.amount)!) })),
        }, 'Lançamento dividido entre categorias.');
      }
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="category-editor">
      <p className="form-help"><strong>{t.description}</strong> · {brl(t.amount)} · {t.date.split('-').reverse().join('/')}</p>
      <div className="auth-switch" role="tablist" aria-label="Forma de categorizar">
        <button type="button" role="tab" aria-selected={!divide} className={!divide ? 'active' : ''} onClick={() => setDivide(false)}>Uma categoria</button>
        <button type="button" role="tab" aria-selected={divide} className={divide ? 'active' : ''} onClick={() => setDivide(true)}>Dividir entre categorias</button>
      </div>
      {!divide ? (
        <label className="field">
          <span>Categoria</span>
          <input list="category-list" required maxLength={80} autoComplete="off" value={single} onChange={(e) => setSingle(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <small>Digite para buscar, ou crie no formato “Grupo / Subcategoria”, por exemplo “Alimentação / Lanche do trabalho”.</small>
        </label>
      ) : (
        <>
          <p className="form-help">Ex.: compra no mercado de R$ 300 → R$ 240 em Alimentação / Mercado e R$ 60 em Casa / Cama, mesa e banho. O lançamento continua um só; os relatórios usam as partes.</p>
          {parts.map((p, i) => (
            <fieldset className="split-row" key={i}>
              <legend>Parte {i + 1}</legend>
              <label className="field">
                <span>Categoria</span>
                <input list="category-list" required maxLength={80} autoComplete="off" value={p.category} onChange={(e) => set(i, { category: e.target.value })} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <label className="field">
                <span>Valor (R$)</span>
                <input inputMode="decimal" required pattern="[0-9.,]+" maxLength={18} value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              </label>
              <label className="field split-note">
                <span>Observação (opcional)</span>
                <input maxLength={160} value={p.description} placeholder="Ex.: travesseiro" onChange={(e) => set(i, { description: e.target.value })} />
              </label>
              <div className="split-actions">
                {remaining !== 0n && <button type="button" className="text-button" onClick={() => fill(i)}><Check size={14} /> Completar com o restante</button>}
                {parts.length > 2 && <button type="button" className="text-button" aria-label={`Remover parte ${i + 1}`} onClick={() => setParts((cur) => cur.filter((_, k) => k !== i))}><Trash2 size={14} /> Remover</button>}
              </div>
            </fieldset>
          ))}
          <div className="split-summary">
            <button type="button" className="text-button" onClick={() => setParts((cur) => [...cur, { category: UNCATEGORIZED, amount: remaining > 0n ? decimal(remaining).replace('.', ',') : '', description: '' }])}>
              <Plus size={14} /> Adicionar parte
            </button>
            <span className={remaining === 0n ? 'ok' : 'pending'}>
              {remaining === 0n ? 'Soma confere com o lançamento' : remaining > 0n ? `Faltam ${brl(decimal(remaining))}` : `Passou ${brl(decimal(-remaining))}`}
            </span>
          </div>
        </>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="modal-footer">
        <button type="button" className="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={busy || (divide && remaining !== 0n)}>{busy ? 'Salvando…' : 'Salvar categoria'} <Check size={16} /></button>
      </div>
    </form>
  );
}
