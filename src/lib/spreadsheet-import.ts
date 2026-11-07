// Interpreta planilhas pessoais (.xlsx) já lidas em células. Roda no navegador; nada é enviado
// até o usuário revisar e confirmar. Reconhece três formatos comuns:
//  1. Tabela mensal: "Descrição | Valor | Vencimento | Pagamento | Status | ..." (uma aba por mês).
//  2. Bloco de parcelas: coluna de datas com valores ao lado (e status), com título acima
//     ("EMPRESTIMO 2 · 24X 178,85", "Dividas Santander").
//  3. Lista de gastos fixos/assinaturas: título "ASSINATURAS MENSAIS" seguido de nome | valor.
import { decimal, cents, validDate } from './money';

export type Cell = string | number | boolean | Date | null;
export type SheetInput = { name: string; rows: Cell[][] };
export type MonthlyItem = {
  key: string; sheet: string; row: number; description: string; amount: string; date: string;
  dateGuessed: boolean; paid: boolean; payment: string; note: string; categoryHint: string;
};
export type ScheduleBlock = {
  key: string; sheet: string; title: string; installments: { date: string; amount: string; paid: boolean }[];
};
export type RecurringItem = { key: string; sheet: string; description: string; amount: string; payment: string };
export type WorkbookAnalysis = {
  monthly: MonthlyItem[]; schedules: ScheduleBlock[]; recurring: RecurringItem[];
  duplicates: number; ignoredSheets: string[];
};

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const isDate = (c: Cell): c is Date => c instanceof Date && !Number.isNaN(c.getTime());
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const months: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

/** Valor monetário de uma célula (número ou texto "1.234,56"/"R$ 10,00"); '' se não houver. */
export function cellMoney(c: Cell): string {
  if (typeof c === 'number' && Number.isFinite(c)) return c > 0 ? decimal(BigInt(Math.round(c * 100))) : '';
  if (typeof c !== 'string') return '';
  const m = c.match(/-?\s*(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/i);
  if (!m) return '';
  try { const v = cents(m[1].replace(/\./g, '').replace(',', '.')); return v > 0n ? decimal(v) : ''; } catch { return ''; }
}
function cellDate(c: Cell): string {
  if (isDate(c)) return isoDate(c);
  if (typeof c === 'string') {
    const m = c.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) { const d = `${m[3]}-${m[2]}-${m[1]}`; return validDate(d) ? d : ''; }
  }
  return '';
}
const dayIn = (year: number, month: number, day: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

/** Mês/ano pelo nome da aba ("Mai25", "Outubro", "abr"); ano pode faltar. */
export function sheetMonth(name: string): { month: number; year?: number } | null {
  const m = norm(name).match(/^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*[-/ ]?(\d{2}|\d{4})?$/);
  if (!m) return null;
  const y = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : undefined;
  return { month: months[m[1]], year: y };
}

const headerWords = /^(descricao|valor|vencimento|pagamento|status|observacao|categoria|qtd|parcela|valor pago|a pagar|total|forma pagamento|data|falta)/;

function monthlyTable(sheet: SheetInput, fallbackYear: number): MonthlyItem[] | null {
  const headerRow = sheet.rows.findIndex((r) => r.some((c) => norm(c).startsWith('descri')) && r.some((c) => norm(c) === 'valor'));
  if (headerRow < 0) return null;
  const header = sheet.rows[headerRow].map(norm);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cDesc = col(/^descri/), cVal = col(/^valor$/), cDue = col(/^venc/), cPay = col(/^pagamento|^pago em|^data pag/),
    cStatus = col(/^status|^situa/), cNote = col(/^obs/), cCat2 = col(/categoria.*2|subcategoria/), cCat1 = col(/categoria(?!.*2)/);
  const ref = sheetMonth(sheet.name);
  // Ano da aba: o informado no nome, senão o mais comum entre as datas da tabela.
  const years = new Map<number, number>();
  for (const r of sheet.rows.slice(headerRow + 1)) for (const c of [r[cDue], r[cPay]]) if (isDate(c ?? null)) {
    const y = (c as Date).getUTCFullYear(); years.set(y, (years.get(y) || 0) + 1);
  }
  const year = ref?.year ?? ([...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fallbackYear);
  const items: MonthlyItem[] = [];
  let blanks = 0;
  for (let i = headerRow + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const description = String(r[cDesc] ?? '').trim();
    if (!description) { if (++blanks >= 3) break; continue; }
    blanks = 0;
    if (headerWords.test(norm(description)) || /^total/.test(norm(description))) continue;
    const due = r[cDue] ?? null, pay = cPay >= 0 ? r[cPay] ?? null : null;
    let date = cellDate(due), dateGuessed = false;
    if (!date && typeof due === 'number' && due >= 1 && due <= 31 && ref) date = dayIn(year, ref.month, Math.round(due));
    if (!date) date = cellDate(pay);
    if (!date && ref) { date = dayIn(year, ref.month, 1); dateGuessed = true; }
    const statusText = cStatus >= 0 ? norm(r[cStatus]) : '';
    const payText = pay !== null && !isDate(pay) && typeof pay === 'string' ? pay.trim() : '';
    items.push({
      key: `${sheet.name}:${i + 1}`, sheet: sheet.name, row: i + 1, description: description.slice(0, 160),
      amount: cellMoney(r[cVal] ?? null), date, dateGuessed,
      paid: /^(pago|paga|quitad|ok)/.test(statusText), payment: payText.slice(0, 80),
      note: cNote >= 0 ? String(r[cNote] ?? '').trim().slice(0, 160) : '',
      categoryHint: [cCat1 >= 0 ? r[cCat1] : '', cCat2 >= 0 ? r[cCat2] : ''].map((c) => String(c ?? '').trim()).filter(Boolean).join(' / '),
    });
  }
  return items;
}

/** Blocos de parcelas: ≥2 linhas seguidas com data numa coluna e valor na coluna à direita. */
function scheduleBlocks(sheet: SheetInput): ScheduleBlock[] {
  const width = Math.max(0, ...sheet.rows.map((r) => r.length));
  const blocks: ScheduleBlock[] = [];
  for (let c = 0; c < width - 1; c++) {
    let i = 0;
    while (i < sheet.rows.length) {
      const ok = (k: number) => isDate(sheet.rows[k]?.[c] ?? null) && cellMoney(sheet.rows[k]?.[c + 1] ?? null) !== '';
      if (!ok(i)) { i++; continue; }
      const start = i;
      const installments: ScheduleBlock['installments'] = [];
      while (i < sheet.rows.length && ok(i)) {
        const r = sheet.rows[i];
        installments.push({ date: cellDate(r[c]), amount: cellMoney(r[c + 1]), paid: /^(pago|paga|quitad|ok)/.test(norm(r[c + 2])) });
        i++;
      }
      if (installments.length < 2) continue;
      // Título: texto acima do bloco (até 5 linhas), na coluna da data ou vizinhas, que não seja cabeçalho.
      let title = '';
      for (let k = start - 1; k >= Math.max(0, start - 5) && !title; k--)
        for (const cc of [c, c - 1, c + 1]) {
          const v = sheet.rows[k]?.[cc];
          if (typeof v === 'string' && v.trim() && !headerWords.test(norm(v)) && !/^\d+\s*x/i.test(v.trim())) { title = v.trim(); break; }
        }
      blocks.push({ key: `${sheet.name}:${start + 1}:${c + 1}`, sheet: sheet.name, title: (title || `Parcelas (${sheet.name})`).slice(0, 120), installments });
    }
  }
  return blocks;
}

/** Listas "ASSINATURAS MENSAIS" / "GASTOS MENSAIS FIXOS": nome | valor | forma de pagamento. */
function recurringLists(sheet: SheetInput): RecurringItem[] {
  const items: RecurringItem[] = [];
  sheet.rows.forEach((r, i) => r.forEach((c, j) => {
    if (typeof c !== 'string' || !/assinatur|fix[oa]s?\b|mensais fix/.test(norm(c))) return;
    for (let k = i + 1; k < sheet.rows.length; k++) {
      const name = sheet.rows[k]?.[j], value = sheet.rows[k]?.[j + 1];
      if (typeof name !== 'string' || !name.trim()) break;
      const amount = cellMoney(value ?? null);
      if (!amount) continue;
      const pay = sheet.rows[k]?.[j + 2];
      items.push({ key: `${sheet.name}:${k + 1}:${j + 1}`, sheet: sheet.name, description: name.trim().slice(0, 160), amount, payment: typeof pay === 'string' ? pay.trim().slice(0, 80) : '' });
    }
  }));
  return items;
}

export function analyzeWorkbook(sheets: SheetInput[], today = new Date().toISOString().slice(0, 10)): WorkbookAnalysis {
  const fallbackYear = Number(today.slice(0, 4));
  const monthly: MonthlyItem[] = [], schedules: ScheduleBlock[] = [], recurring: RecurringItem[] = [], ignoredSheets: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const sheet of sheets) {
    const table = monthlyTable(sheet, fallbackYear);
    if (table) {
      for (const item of table) {
        // Mesma conta repetida em abas diferentes (ex.: "Mai" e "Mai25"): fica uma só.
        const id = `${norm(item.description)}|${item.amount}|${item.date}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        monthly.push(item);
      }
      continue;
    }
    const blocks = scheduleBlocks(sheet), lists = recurringLists(sheet);
    if (!blocks.length && !lists.length) ignoredSheets.push(sheet.name);
    schedules.push(...blocks);
    recurring.push(...lists);
  }
  monthly.sort((a, b) => a.date.localeCompare(b.date));
  return { monthly, schedules, recurring, duplicates, ignoredSheets };
}

/** Parcelas lidas de um texto (print/OCR): linhas com data e valor; "pago" marca a parcela. */
export function parseScheduleText(text: string, today = new Date().toISOString().slice(0, 10)) {
  const year = Number(today.slice(0, 4));
  const out: { date: string; amount: string; paid: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const full = line.match(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/);
    const short = full ? null : line.match(/\b(\d{2})\/(\d{2})\b(?!\/)/);
    const money = [...line.matchAll(/(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\b/gi)].at(-1);
    if (!money || (!full && !short)) continue;
    const y = full ? (full[3].length === 2 ? 2000 + Number(full[3]) : Number(full[3])) : year;
    const d = `${y}-${(full || short)![2]}-${(full || short)![1]}`;
    if (!validDate(d)) continue;
    out.push({ date: d, amount: cellMoney(money[1]), paid: /\bpag[oa]\b|quitad/i.test(line) });
  }
  return out.filter((p) => p.amount);
}
