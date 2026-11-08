'use client';
import { useMemo, useState } from 'react';
import { Check, FileSpreadsheet, X } from 'lucide-react';
import type { FinanceState } from '@/lib/types';
import { addDays, brl, cents, decimal } from '@/lib/money';
import { analyzeWorkbook, type MonthlyItem, type ScheduleBlock, type RecurringItem, type Cell } from '@/lib/spreadsheet-import';
import { buildMemory, suggestCategory, UNCATEGORIZED } from '@/lib/categorize';
import { accountLabel } from './card-fields';
import Hint from './hint';
import CategorySelect from './category-select';

type Act = (action: string, payload: unknown, message?: string) => Promise<unknown>;
type M = MonthlyItem & { selected: boolean; category: string };
type S = ScheduleBlock & { selected: boolean; direction: 'payable' | 'receivable'; contract_type: string };
type R = RecurringItem & { selected: boolean; category: string; due_day: string };
const fmt = (d: string) => d.split('-').reverse().join('/');
const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const sumOf = (xs: { amount: string }[]) => xs.reduce((n, x) => { try { return n + cents(x.amount); } catch { return n; } }, 0n);

/**
 * Importar planilha (.xlsx): leitura no navegador, revisão de tudo que foi reconhecido e
 * gravação só do que o usuário marcar. O arquivo não é enviado nem guardado.
 */
export default function SheetImport({ data, act }: { data: FinanceState; act: Act }) {
  const [monthly, setMonthly] = useState<M[]>([]), [schedules, setSchedules] = useState<S[]>([]), [recurring, setRecurring] = useState<R[]>([]);
  const [hashHex, setHash] = useState(''), [info, setInfo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [paidMode, setPaidMode] = useState<'history' | 'account'>('history'), [account, setAccount] = useState('');
  const memory = useMemo(() => buildMemory(data.transactions.filter((t) => t.kind !== 'transfer')), [data.transactions]);
  const loaded = hashHex !== '';
  const suggest = (description: string, hint = '') => {
    const s = suggestCategory(description, 'expense', memory);
    if (s !== UNCATEGORIZED || !hint) return s;
    const fromHint = suggestCategory(hint.split(' / ').at(-1) || hint, 'expense', memory);
    return fromHint !== UNCATEGORIZED ? fromHint : title(hint.split(' / ').at(-1) || '');
  };

  function reset() { setMonthly([]); setSchedules([]); setRecurring([]); setHash(''); setInfo(''); setError(''); }
  async function read(file: File) {
    reset(); setBusy(true);
    try {
      if (file.size > 8_000_000) throw new Error('Use uma planilha de até 8 MB.');
      if (!/\.xlsx$/i.test(file.name)) throw new Error('Use um arquivo .xlsx (Excel). Para .csv, use a importação de extrato.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { documentDigest } = await import('@/lib/document-reader');
      const digest = await documentDigest(bytes.slice());
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const sheets = await readXlsxFile(file);
      const a = analyzeWorkbook(sheets.map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] })), data.today);
      const stale = addDays(data.today, -45);
      setMonthly(a.monthly.map((m) => ({ ...m, selected: !!m.amount && (m.paid || m.date >= stale), category: suggest(m.description, m.categoryHint) })));
      setSchedules(a.schedules.map((s) => ({ ...s, selected: true, direction: 'payable', contract_type: /acordo|divida/i.test(s.title) ? 'agreement' : 'loan' })));
      setRecurring(a.recurring.map((r) => ({ ...r, selected: true, category: suggest(r.description), due_day: '10' })));
      setHash(digest);
      setInfo(`Encontrei ${a.monthly.length} contas mensais em ${new Set(a.monthly.map((m) => m.sheet)).size} abas${a.duplicates ? ` (${a.duplicates} repetidas entre abas foram juntadas)` : ''}, ${a.schedules.length} empréstimos/acordos e ${a.recurring.length} gastos fixos. Revise e marque o que deve entrar.${a.ignoredSheets.length ? ` Abas sem formato reconhecido: ${a.ignoredSheets.join(', ')}.` : ''}`);
      bytes.fill(0);
    } catch (e) { setError((e as Error).message || 'Não foi possível ler a planilha.'); }
    finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError('');
    try {
      const chosenM = monthly.filter((m) => m.selected && m.amount && m.date);
      const r = await act('sheet.import', {
        source_hash: hashHex, paid_mode: paidMode, account_id: paidMode === 'account' ? account || undefined : undefined,
        monthly: chosenM.map((m) => ({ description: m.description, amount: m.amount, date: m.date, paid: m.paid, category: m.category })),
        schedules: schedules.filter((s) => s.selected).map((s) => ({ title: s.title, direction: s.direction, contract_type: s.contract_type, category: '', installments: s.installments })),
        recurring: recurring.filter((x) => x.selected).map((x) => ({ description: x.description, amount: x.amount, due_day: x.due_day, months: 12, category: x.category })),
      }, 'Planilha importada.') as Record<string, number>;
      reset();
      setInfo(`Importado: ${r.monthly} contas mensais (${r.payments} lançadas na conta, ${r.history} como histórico pago), ${r.schedules} empréstimos/acordos, ${r.recurring} gastos fixos. ${r.skipped ? `${r.skipped} já existiam e foram ignorados.` : ''} A planilha não foi guardada.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const sheets = [...new Set(monthly.map((m) => m.sheet))];
  const setM = (key: string, c: Partial<M>) => setMonthly((cur) => cur.map((m) => (m.key === key ? { ...m, ...c } : m)));
  const setS = (key: string, c: Partial<S>) => setSchedules((cur) => cur.map((s) => (s.key === key ? { ...s, ...c } : s)));
  const setR = (key: string, c: Partial<R>) => setRecurring((cur) => cur.map((s) => (s.key === key ? { ...s, ...c } : s)));
  const selM = monthly.filter((m) => m.selected), selS = schedules.filter((s) => s.selected), selR = recurring.filter((r) => r.selected);
  const nothing = !selM.length && !selS.length && !selR.length;

  return (
    <section className="panel sheet-import">
      <div className="panel-heading"><div><h2><FileSpreadsheet size={18} /> Planilha Excel</h2><p>Contas do mês, empréstimos, acordos e gastos fixos · .xlsx até 8 MB</p></div></div>
      <div className="padded-form">
        <Hint short="Lida no seu aparelho. Só entra o que você marcar.">A planilha não é enviada nem guardada. Reimportar a mesma planilha não duplica nada.</Hint>
        <label className="field"><span>Planilha .xlsx</span><input type="file" accept=".xlsx" disabled={busy} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} /></label>
        {busy && <p role="status" className="page-footnote">Processando…</p>}
        {info && <p role="status" className="page-footnote">{info}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {loaded && (
          <>
            {monthly.length > 0 && (
              <details className="import-section">
                <summary><strong>Contas mensais</strong> · {selM.length} de {monthly.length} marcadas · {brl(decimal(sumOf(selM)))}</summary>
                <div className="form-grid">
                  <label className="field"><span>Contas marcadas como PAGO</span>
                    <select value={paidMode} onChange={(e) => setPaidMode(e.target.value as 'history' | 'account')}>
                      <option value="history">Só histórico (não altera saldos)</option>
                      <option value="account">Lançar como pagamento na conta…</option>
                    </select>
                  </label>
                  {paidMode === 'account' && <label className="field"><span>Conta dos pagamentos</span><select value={account} onChange={(e) => setAccount(e.target.value)} required><option value="">Selecione</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select><small>Datas anteriores ao início da conta ficam como histórico.</small></label>}
                </div>
                <Hint short="Pendentes antigas vêm desmarcadas.">Contas pendentes com mais de 45 dias vêm desmarcadas (provavelmente já resolvidas). Linhas sem valor não entram.</Hint>
                {sheets.map((sheet) => {
                  const items = monthly.filter((m) => m.sheet === sheet);
                  const all = items.every((m) => m.selected || !m.amount);
                  return (
                    <details key={sheet} className="import-sheet">
                      <summary>
                        <label className="checkbox-label" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={all} onChange={(e) => setMonthly((cur) => cur.map((m) => (m.sheet === sheet && m.amount ? { ...m, selected: e.target.checked } : m)))} />
                          Aba “{sheet}”
                        </label>
                        <span>{items.filter((m) => m.selected).length}/{items.length}</span>
                      </summary>
                      {items.map((m) => (
                        <div key={m.key} className={`import-row ${m.selected ? '' : 'off'}`}>
                          <input type="checkbox" aria-label={`Importar ${m.description}`} checked={m.selected} disabled={!m.amount} onChange={(e) => setM(m.key, { selected: e.target.checked })} />
                          <span className="import-desc">{m.description}{m.note && <small>{m.note}</small>}</span>
                          <input className="import-amount" inputMode="decimal" aria-label="Valor" value={m.amount} placeholder="sem valor" onChange={(e) => { const v = e.target.value; const c = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v; setM(m.key, { amount: c, selected: !!c }); }} />
                          <input type="date" aria-label="Vencimento" value={m.date} onChange={(e) => setM(m.key, { date: e.target.value, dateGuessed: false })} className={m.dateGuessed ? 'guessed' : ''} title={m.dateGuessed ? 'Data deduzida pelo nome da aba' : ''} />
                          <CategorySelect hideLabel value={m.category} onChange={(v) => setM(m.key, { category: v })} />
                          <span className={`status-pill ${m.paid ? 'paid' : 'open'}`}>{m.paid ? 'Pago' : 'Pendente'}</span>
                        </div>
                      ))}
                    </details>
                  );
                })}
              </details>
            )}
            {schedules.length > 0 && (
              <details open className="import-section">
                <summary><strong>Empréstimos e acordos</strong> · {selS.length} de {schedules.length} marcados</summary>
                {schedules.map((s) => {
                  const paid = s.installments.filter((p) => p.paid), open = s.installments.filter((p) => !p.paid);
                  return (
                    <div key={s.key} className={`import-loan ${s.selected ? '' : 'off'}`}>
                      <input type="checkbox" aria-label={`Importar ${s.title}`} checked={s.selected} onChange={(e) => setS(s.key, { selected: e.target.checked })} />
                      <div>
                        <input aria-label="Nome" value={s.title} maxLength={120} onChange={(e) => setS(s.key, { title: e.target.value })} />
                        <small>{s.installments.length} parcelas de {brl(s.installments[0].amount)} · {fmt(s.installments[0].date)} a {fmt(s.installments.at(-1)!.date)} · {paid.length} pagas · em aberto {brl(decimal(sumOf(open)))}</small>
                      </div>
                      <select aria-label="Direção" value={s.direction} onChange={(e) => setS(s.key, { direction: e.target.value as S['direction'] })}><option value="payable">Eu devo</option><option value="receivable">Me devem</option></select>
                      <select aria-label="Tipo" value={s.contract_type} onChange={(e) => setS(s.key, { contract_type: e.target.value })}><option value="loan">Empréstimo</option><option value="agreement">Acordo</option><option value="financing">Financiamento</option></select>
                    </div>
                  );
                })}
              </details>
            )}
            {recurring.length > 0 && (
              <details open className="import-section">
                <summary><strong>Gastos fixos e assinaturas</strong> · {selR.length} de {recurring.length} · {brl(decimal(sumOf(selR)))}/mês</summary>
                <Hint short="Viram compromissos dos próximos 12 meses." />
                {recurring.map((x) => (
                  <div key={x.key} className={`import-row ${x.selected ? '' : 'off'}`}>
                    <input type="checkbox" aria-label={`Importar ${x.description}`} checked={x.selected} onChange={(e) => setR(x.key, { selected: e.target.checked })} />
                    <span className="import-desc">{x.description}{x.payment && <small>{x.payment}</small>}</span>
                    <span className="import-amount">{brl(x.amount)}</span>
                    <label className="day-input">dia <input type="number" min={1} max={31} value={x.due_day} onChange={(e) => setR(x.key, { due_day: e.target.value })} aria-label="Dia de vencimento" /></label>
                    <CategorySelect hideLabel value={x.category} onChange={(v) => setR(x.key, { category: v })} />
                  </div>
                ))}
              </details>
            )}
            <div className="row-actions">
              <button className="button primary" disabled={busy || nothing || (paidMode === 'account' && !account)} onClick={confirm}><Check size={16} /> Importar {selM.length + selS.length + selR.length} itens marcados</button>
              <button className="button" disabled={busy} onClick={reset}><X size={16} /> Descartar</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
