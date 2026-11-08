'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { Target, Trash2 } from 'lucide-react';
import type { FinanceState } from '@/lib/types';
import { brl, decimal } from '@/lib/money';
import { budgetStatus, goalProgress, lastMonths, monthlyByGroup, topMerchants } from '@/lib/planning';
import { accountLabel } from './card-fields';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
const clean = (v: string) => (v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export default function ReportsPage({ data, act }: { data: FinanceState; act: Act }) {
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const budgets = useMemo(() => budgetStatus(data.budgets, data.transactions, data.splits, month), [data, month]);
  const months = lastMonths(month, 6);
  const table = useMemo(() => monthlyByGroup(data.transactions, data.splits, months), [data, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const merchants = useMemo(() => topMerchants(data.transactions, month), [data.transactions, month]);

  async function run(action: string, payload: unknown, message: string, form?: HTMLFormElement) {
    setBusy(true);
    try { await act(action, payload, message); form?.reset(); } catch { /* erro exibido pelo app */ } finally { setBusy(false); }
  }
  function addBudget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    run('budget.set', { category: f.get('category'), amount: clean(String(f.get('amount'))) }, 'Orçamento salvo.', e.currentTarget);
  }
  function addGoal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    run('goal.create', { ...f, target: clean(f.target), saved: clean(f.saved || '0') }, 'Meta criada.', e.currentTarget);
  }

  return (
    <div className="reports">
      <label className="field month-pick"><span>Mês</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value || month)} /></label>

      <section className="panel padded-form">
        <h2>Orçamentos do mês</h2>
        {budgets.length === 0 && <p className="form-help">Defina um limite por categoria, como Alimentação / Delivery até R$ 400.</p>}
        {budgets.map((b) => (
          <div key={b.category} className={`budget-row ${b.level}`}>
            <div className="category-label"><span>{b.category}</span><strong>{brl(decimal(b.spent))} de {brl(b.amount)}</strong></div>
            <div className="bar-track"><span style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
            <small>{b.level === 'over' ? `Passou ${Math.round(b.pct - 100)}%` : b.level === 'warn' ? `${Math.round(b.pct)}% usado — atenção` : `${Math.round(b.pct)}% usado`}
              <button type="button" className="text-button" disabled={busy} aria-label={`Remover orçamento ${b.category}`} onClick={() => run('budget.delete', { category: b.category }, 'Orçamento removido.')}><Trash2 size={12} /></button></small>
          </div>
        ))}
        <form onSubmit={addBudget} className="inline-form">
          <input name="category" list="category-list" required maxLength={80} placeholder="Categoria (ex.: Alimentação / Delivery)" autoComplete="off" />
          <input name="amount" inputMode="decimal" required pattern="[0-9.,]+" placeholder="Limite R$" />
          <button className="button" disabled={busy}>Salvar</button>
        </form>
      </section>

      <section className="panel padded-form">
        <h2><Target size={17} /> Metas</h2>
        {data.goals.map((g) => {
          const p = goalProgress(g, data.accounts, data.today);
          return (
            <div key={g.id} className="budget-row ok">
              <div className="category-label"><span>{g.name}</span><strong>{brl(decimal(p.current))} de {brl(g.target)}</strong></div>
              <div className="bar-track"><span style={{ width: `${p.pct}%` }} /></div>
              <small>
                {Math.round(p.pct)}%{p.monthly !== null && p.monthly > 0n ? ` · guardar ${brl(decimal(p.monthly))}/mês por ${p.monthsLeft} meses` : ''}
                {!g.account_id && <button type="button" className="text-button" disabled={busy} onClick={() => { const v = prompt('Quanto já está guardado? (R$)', g.saved.replace('.', ',')); if (v !== null) run('goal.update', { ...g, deadline: g.deadline || '', account_id: '', saved: clean(v) || '0' }, 'Meta atualizada.'); }}>Atualizar valor</button>}
                <button type="button" className="text-button" disabled={busy} aria-label={`Remover meta ${g.name}`} onClick={() => run('goal.delete', { id: g.id }, 'Meta removida.')}><Trash2 size={12} /></button>
              </small>
            </div>
          );
        })}
        <form onSubmit={addGoal} className="inline-form wrap">
          <input name="name" required maxLength={80} placeholder="Meta (ex.: Reserva de emergência)" />
          <input name="target" inputMode="decimal" required pattern="[0-9.,]+" placeholder="Valor R$" />
          <input name="deadline" type="date" aria-label="Prazo" />
          <select name="account_id" aria-label="Conta vinculada"><option value="">Valor guardado manual</option>{data.accounts.filter((a) => a.type !== 'credit_card').map((a) => <option key={a.id} value={a.id}>Saldo de {accountLabel(a)}</option>)}</select>
          <button className="button" disabled={busy}>Criar meta</button>
        </form>
      </section>

      <section className="panel padded-form">
        <h2>Gastos mês a mês</h2>
        {table.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Grupo</th>{months.map((m) => <th key={m} className="align-right">{monthLabel(m)}</th>)}<th className="align-right">Variação</th></tr></thead>
              <tbody>
                {table.map((r) => {
                  const [prev, cur] = [r.values.at(-2)!, r.values.at(-1)!];
                  const delta = prev ? Math.round(Number(((cur - prev) * 1000n) / prev) / 10) : null;
                  return (
                    <tr key={r.group}>
                      <td>{r.group}</td>
                      {r.values.map((v, i) => <td key={i} className="align-right">{v ? brl(decimal(v)) : '—'}</td>)}
                      <td className={`align-right ${delta !== null && delta > 0 ? 'negative' : ''}`}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="form-help">Sem despesas nos últimos 6 meses.</p>}
      </section>

      <section className="panel padded-form">
        <h2>Onde você mais gastou</h2>
        {merchants.length ? (
          <ol className="merchant-list">
            {merchants.map((m) => <li key={m.name}><span>{m.name}</span><span>{brl(decimal(m.total))}<small> · {m.count}x</small></span></li>)}
          </ol>
        ) : <p className="form-help">Sem despesas neste mês.</p>}
      </section>

    </div>
  );
}
