'use client';
import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react';
import { categoryGroup, categorySub, cleanCategory, SEPARATOR, UNCATEGORIZED } from '@/lib/categorize';

/** Lista de categorias disponíveis (prontas + personalizadas + já usadas), fornecida pelo app. */
export const CategoryOptions = createContext<string[]>([]);

const NEW = '__nova__';
const join = (group: string, sub: string) => (sub ? `${group}${SEPARATOR}${sub}` : group);

/**
 * Categoria em duas listas suspensas: grupo e subcategoria. A última opção de cada lista
 * permite incluir uma nova. Funciona controlado (value/onChange) ou dentro de formulário (name).
 */
export default function CategorySelect({
  value, defaultValue = UNCATEGORIZED, onChange, name, required, label = 'Categoria', hideLabel,
}: {
  value?: string; defaultValue?: string; onChange?: (v: string) => void; name?: string;
  required?: boolean; label?: string; hideLabel?: boolean;
}) {
  const options = useContext(CategoryOptions);
  const [inner, setInner] = useState(value ?? defaultValue);
  useEffect(() => { if (value !== undefined) setInner(value); }, [value]);
  const current = cleanCategory(inner || '') || UNCATEGORIZED;
  const group = categoryGroup(current), sub = categorySub(current);
  const [newGroup, setNewGroup] = useState(false), [newSub, setNewSub] = useState(false);

  const tree = useMemo(() => {
    const t = new Map<string, string[]>();
    for (const o of [...options, current]) {
      const g = categoryGroup(o), s = categorySub(o);
      if (!g || g === UNCATEGORIZED) continue;
      if (!t.has(g)) t.set(g, []);
      if (s && !t.get(g)!.some((x) => x.toLowerCase() === s.toLowerCase())) t.get(g)!.push(s);
    }
    return t;
  }, [options, current]);
  const groups = [...tree.keys()];
  const subs = tree.get(group) || [];

  function set(next: string) {
    const v = cleanCategory(next) || UNCATEGORIZED;
    setInner(v);
    onChange?.(v);
  }
  const groupId = useId();

  return (
    <div className="category-select" role="group" aria-label={label}>
      {name && <input type="hidden" name={name} value={current} />}
      <label className="field">
        <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
        {newGroup ? (
          <input id={groupId} autoFocus required={required} maxLength={40} placeholder="Nome da nova categoria"
            onChange={(e) => set(e.target.value.replace(/[/>›]/g, ' '))}
            onBlur={(e) => { if (!e.target.value.trim()) { setNewGroup(false); set(UNCATEGORIZED); } }} />
        ) : (
          <select id={groupId} value={group === UNCATEGORIZED ? UNCATEGORIZED : group} required={required}
            onChange={(e) => {
              if (e.target.value === NEW) { setNewGroup(true); setNewSub(false); set(UNCATEGORIZED); return; }
              setNewSub(false);
              set(e.target.value);
            }}>
            <option value={UNCATEGORIZED}>Sem categoria</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value={NEW}>+ Nova categoria…</option>
          </select>
        )}
      </label>
      {group !== UNCATEGORIZED && (
        <label className="field">
          <span className={hideLabel ? 'sr-only' : ''}>Subcategoria</span>
          {newSub ? (
            <input autoFocus maxLength={40} placeholder="Nome da nova subcategoria"
              onChange={(e) => set(join(group, e.target.value.replace(/[/>›]/g, ' ')))}
              onBlur={(e) => { if (!e.target.value.trim()) setNewSub(false); }} />
          ) : (
            <select value={sub} aria-label={`Subcategoria de ${group}`}
              onChange={(e) => {
                if (e.target.value === NEW) { setNewSub(true); set(group); return; }
                set(join(group, e.target.value));
              }}>
              <option value="">{subs.length ? 'Escolha (opcional)' : 'Sem subcategoria'}</option>
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value={NEW}>+ Nova subcategoria…</option>
            </select>
          )}
        </label>
      )}
    </div>
  );
}
