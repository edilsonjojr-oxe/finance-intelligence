// Leitura de contracheque / holerite / demonstrativo de pagamento.
// Gera lançamentos realizados na data do pagamento, de forma que:
//  - o saldo da conta no dia do pagamento suba exatamente o valor líquido;
//  - as receitas do mês somem o bruto (proventos) e as despesas, os descontos reais;
//  - o adiantamento já recebido (ex.: dia 15) entre na data dele, e não seja contado duas vezes.
// Nada é inventado: valores vêm do documento; a data do adiantamento é sugerida e editável.
import { cents, decimal } from './money';
import type { ExtractedItem } from './intake';

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const moneyToken = /-?\s*(?:R\$\s*)?-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/;
const toCents = (s: string) => cents(s.replace(/[^\d,]/g, '').replace(',', '.'));
const dmy = (s: string) => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

export type PayslipLine = { description: string; kind: 'earning' | 'deduction'; amount: bigint; advance: boolean };
export type Payslip = {
  employer: string; bank: string; competence: string; paymentDate: string; lines: PayslipLine[];
  earnings: bigint; deductions: bigint; net: bigint | null; consistent: boolean;
};

export function isPayslip(text: string) {
  const t = normalize(text);
  return /(demonstrativo de pagamento|contracheque|contra-cheque|holerite|recibo de pagamento de salario|folha de pagamento)/.test(t)
    && /(proventos|vencimentos)/.test(t) && /descontos/.test(t);
}

// Palavras que indicam desconto quando o layout não separa as colunas por "-".
const deductionWords = /\b(inss|irrf|imposto|desc\.?|desconto|emprestimo|consignado|contribuicao|cota|sindical|pensao|plano|odonto|vale|refeic|falta|atraso|adto|adiantamento|coparticipacao|seguro)/;
const advanceWords = /\b(adto|adiantamento)\b/;
const ignoreLine = /^(descricao|totais?|total de|valor liquido|liquido|salario[- ]base|base de calculo|fgts|dependentes|banco|agencia|numero da conta|data de|empresa|cnpj|colaborador|cpf|matricula|cargo|pagina|calculo)/;

export function parsePayslip(text: string): Payslip | null {
  if (!isPayslip(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join(' ');
  const competence = flat.match(/(?:compet[eê]ncia|refer[eê]ncia|sal[aá]rio)\s*[-:]?\s*(\d{2})\/(\d{4})/i) || flat.match(/\b(\d{2})\/(\d{4})\b/);
  const comp = competence ? `${competence[2]}-${competence[1]}` : '';
  const paymentDate = dmy(flat.match(/data (?:de|do) pagamento[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '')
    || dmy(flat.match(/(?:pago em|cr[eé]dito em)[^\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '');
  const employer = (flat.match(/empresa:\s*(.+?)\s{2,}(?:cnpj|[A-Z][a-z]+:)/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const bank = (flat.match(/banco:\s*([A-Za-zÀ-ú .]+?)\s{2,}/i)?.[1] || '').trim();
  const net = (() => { const m = flat.match(/(?:valor\s+)?l[ií]quido(?:\s+a\s+receber)?\s*:?\s*(R\$\s*[\d.]+,\d{2})/i); return m ? toCents(m[1]) : null; })();

  const out: PayslipLine[] = [];
  for (const raw of lines) {
    const n = normalize(raw);
    if (ignoreLine.test(n)) continue;
    // Colunas finais: [proventos] [descontos] [informativas], com "-" nas vazias (ex.: "R$ 300,47 - -").
    const cols = raw.match(/^(.*?)\s+((?:-?R\$\s*-?[\d.]+,\d{2}|-|[\d.]+,\d{2})(?:\s+(?:-?R\$\s*-?[\d.]+,\d{2}|-|[\d.]+,\d{2})){1,3})\s*$/);
    if (!cols) continue;
    let description = cols[1].replace(/\s+[\d.,]+\s*$/, '').trim(); // tira a coluna "Referência"
    if (!description || !/[a-zA-ZÀ-ú]{3}/.test(description)) continue;
    const tokens = [...cols[2].matchAll(/-?\s*R\$\s*-?[\d.]+,\d{2}|-?[\d.]+,\d{2}|-(?=\s|$)/g)].map((m) => m[0].trim());
    const values = tokens.map((t) => (moneyToken.test(t) ? t : null));
    const filled = values.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) continue;
    let kind: 'earning' | 'deduction';
    let token: string;
    if (tokens.length >= 2 && values.some((v) => v === null)) {
      // Layout com colunas marcadas: 1ª = provento, 2ª = desconto, 3ª+ = informativa (ignorada).
      if (values[0]) { kind = 'earning'; token = values[0]; }
      else if (values[1]) { kind = 'deduction'; token = values[1]; }
      else continue;
    } else {
      // Sem marcação: último valor da linha; sinal negativo ou palavra-chave indicam desconto.
      token = values[filled.at(-1)!]!;
      kind = /-\s*(R\$)?\s*\d|R\$\s*-/.test(token) || deductionWords.test(normalize(description)) ? 'deduction' : 'earning';
    }
    const amount = toCents(token);
    if (amount <= 0n) continue;
    description = description.replace(/\s{2,}/g, ' ');
    out.push({ description, kind, amount, advance: kind === 'deduction' && advanceWords.test(normalize(description)) });
  }
  if (!out.length) return null;
  const earnings = out.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amount, 0n);
  const deductions = out.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount, 0n);
  return { employer, bank, competence: comp, paymentDate, lines: out, earnings, deductions, net, consistent: net === null || earnings - deductions === net };
}

function deductionCategory(d: string) {
  const n = normalize(d);
  if (/inss|irrf|imposto|\bir\b/.test(n)) return 'Impostos e taxas / Impostos';
  if (/emprestimo|consignado/.test(n)) return 'Dívidas e empréstimos / Parcelas de empréstimo';
  if (/refeic|aliment|vale refeicao|restaurante/.test(n)) return 'Alimentação / Restaurantes e lanches';
  if (/plano|saude|odonto|medic|coparticipacao/.test(n)) return 'Saúde / Plano de saúde';
  if (/transporte/.test(n)) return 'Transporte / Transporte público';
  return 'Outros';
}
function earningCategory(d: string) {
  const n = normalize(d);
  if (/reembolso|ressarcimento/.test(n)) return 'Receitas / Reembolsos e estornos';
  return 'Receitas / Salário';
}

/**
 * Lançamentos realizados. O adiantamento descontado vira uma entrada na data em que foi recebido
 * (sugerida: dia 15 do mês de competência) e o salário do dia do pagamento já vem sem ele.
 */
export function payslipItems(p: Payslip, today: string): ExtractedItem[] {
  const pay = p.paymentDate || today;
  const label = p.competence ? ` (contracheque ${p.competence.slice(5)}/${p.competence.slice(0, 4)})` : ' (contracheque)';
  const advance = p.lines.filter((l) => l.advance).reduce((s, l) => s + l.amount, 0n);
  const items: ExtractedItem[] = [];
  const earnings = p.lines.filter((l) => l.kind === 'earning').sort((a, b) => (a.amount > b.amount ? -1 : 1));
  let remaining = advance;
  earnings.forEach((l, i) => {
    // O adiantamento já recebido sai do maior provento (normalmente o salário).
    const cut = remaining > 0n && l.amount > remaining ? remaining : 0n;
    remaining -= cut;
    const amount = l.amount - cut;
    if (amount <= 0n) return;
    items.push({
      key: `payslip-earning-${i}`, kind: 'income', event_type: 'paid', date: pay, amount: decimal(amount),
      category: earningCategory(l.description),
      description: (cut ? `${l.description} (sem o adiantamento de R$ ${decimal(cut).replace('.', ',')})` : l.description) + label,
    });
  });
  p.lines.filter((l) => l.kind === 'deduction' && !l.advance).forEach((l, i) => {
    items.push({ key: `payslip-deduction-${i}`, kind: 'expense', event_type: 'paid', date: pay, amount: decimal(l.amount), category: deductionCategory(l.description), description: l.description + label });
  });
  if (advance > 0n && remaining === 0n) {
    const comp = p.competence || pay.slice(0, 7);
    const advDate = `${comp}-15` < pay ? `${comp}-15` : pay;
    items.push({ key: 'payslip-advance', kind: 'income', event_type: 'paid', date: advDate, amount: decimal(advance), category: 'Receitas / Salário', description: `Adiantamento salarial${label}` });
  }
  return items;
}
