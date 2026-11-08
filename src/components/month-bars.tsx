'use client';
import { brl } from '@/lib/money';

export type MonthPoint = { month: string; balance: number };
const label = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
const compact = (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/**
 * Saldo previsto ao fim de cada mês, em barras. Negativos descem abaixo da linha do zero, em
 * vermelho; o último mês fica em destaque. O valor exato de cada barra fica no rótulo acessível.
 */
export default function MonthBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(0, ...points.map((p) => p.balance));
  const min = Math.min(0, ...points.map((p) => p.balance));
  const span = max - min || 1;
  const zero = (max / span) * 100; // % da altura acima da linha do zero
  return (
    <div className="month-bars" role="list" aria-label="Saldo previsto ao fim de cada mês">
      <div className="month-bars-plot">
        {min < 0 && <span className="month-bars-zero" style={{ top: `${zero}%` }} />}
        {points.map((p, i) => {
          const h = (Math.abs(p.balance) / span) * 100;
          const neg = p.balance < 0;
          const last = i === points.length - 1;
          return (
            <div key={p.month} className="month-bar-col" role="listitem" aria-label={`${label(p.month)}: ${brl(p.balance.toFixed(2))}`} title={`${label(p.month)}: ${brl(p.balance.toFixed(2))}`}>
              <span className={`month-bar-value ${neg ? 'negative' : ''}`} style={neg ? { top: `calc(${zero + h}% + 4px)` } : { bottom: `calc(${100 - zero + h}% + 4px)` }}>{compact(p.balance)}</span>
              <span className={`month-bar ${neg ? 'neg' : last ? 'last' : ''}`} style={neg ? { top: `${zero}%`, height: `${Math.max(h, 1)}%` } : { bottom: `${100 - zero}%`, height: `${Math.max(h, 1)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="month-bars-labels">{points.map((p) => <span key={p.month}>{label(p.month)}</span>)}</div>
    </div>
  );
}
