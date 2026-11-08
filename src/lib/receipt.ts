// Cupom fiscal / NFC-e (texto de PDF, OCR ou colado) → itens com categoria por produto.
// Regras conservadoras: só linhas com valor no fim; totais, pagamentos e cabeçalhos são ignorados.
import { cents, decimal, validDate } from './money';
import { merchantKey, SEPARATOR, type CategoryMemory } from './categorize';

export type ReceiptItem = { key: string; description: string; amount: string; category: string };
export type Receipt = { store: string; date: string; total: string; discount: string; items: ReceiptItem[] };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MONEY = /(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g;
const toDec = (v: string) => decimal(cents(v.replace(/\./g, '').replace(',', '.')));
const SKIP = /total|subtotal|desconto|acrescimo|troco|pagamento|pago|dinheiro|cartao|credito|debito|pix|cpf|cnpj|consumidor|tributos|lei 12|ie:|chave de acesso|protocolo|valor a pagar|qtd\.? total|forma de pag|vl\.? aprox|serie|emissao|nfc-?e|danfe|documento auxiliar/;

const P = (g: string, s: string) => `${g}${SEPARATOR}${s}`;
// Primeira regra que casar vence; padrão: Alimentação / Mercado.
const productRules: [string, RegExp][] = [
  [P('Casa', 'Cama, mesa e banho'), /travesseir|toalha|lencol|fronha|edredom|cobertor|colcha|tapete|cortina|jogo de cama|pano de prato/],
  [P('Alimentação', 'Bebidas'), /cerveja|chopp|vinho|vodka|whisky|cachaca|\bgin\b|espumante|refrigerante|\brefri\b|\bcoca\b|guarana|energetico/],
  [P('Casa', 'Limpeza'), /detergente|sabao|lava ?roupa|amaciante|desinfetante|agua sanitaria|alvejante|multiuso|limpador|esponja|vassoura|\brodo\b|saco (?:de )?lixo|lustra ?moveis|\bcloro\b|tira ?manchas|\bveja\b|pinho sol|\bype\b|\bomo\b|bombril|\blimpa\b/],
  [P('Cuidados pessoais', 'Higiene'), /shampoo|xampu|condicionador|sabonete|creme dental|pasta de dente|escova dent|fio dental|desodorante|papel higienico|absorvente|fralda|lenco umedecido|aparelho de barbear|barbear|cotonete|algodao|hidratante|protetor solar/],
  [P('Pets', 'Ração e petshop'), /racao|petisco|areia (?:sanitaria|gato)|pet\b|whiskas|pedigree|golden/],
  [P('Saúde', 'Farmácia'), /dipirona|paracetamol|ibuprofeno|dorflex|neosaldina|vitamina|curativo|band-?aid|termometro|soro fisiologico/],
  [P('Casa', 'Utensílios e decoração'), /pote|copo|prato|talher|panela|frigideira|vela|pilha|lampada|extensao|organizador|cabide|vaso|caneca|garrafa termica|tupperware|forma de/],
];

export function productCategory(description: string, memory?: CategoryMemory) {
  const key = merchantKey(description);
  const remembered = key ? memory?.get(key) : undefined;
  if (remembered) return remembered;
  const text = norm(description);
  for (const [category, re] of productRules) if (re.test(text)) return category;
  return P('Alimentação', 'Mercado');
}

/** Memória de produtos: descrições das partes divididas ("arroz, feijão") por categoria. */
export function productMemory(parts: { category: string; description: string }[]): CategoryMemory {
  const m: CategoryMemory = new Map();
  for (const p of parts) for (const item of p.description.split(/\s*,\s*/)) {
    const key = merchantKey(item);
    if (key) m.set(key, p.category);
  }
  return m;
}

export function parseReceipt(text: string, memory?: CategoryMemory): Receipt {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = norm(text);
  const date = (() => { const m = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/); const d = m ? `${m[3]}-${m[2]}-${m[1]}` : ''; return validDate(d) ? d : ''; })();
  const pick = (re: RegExp) => { const m = flat.match(re); return m ? toDec(m[1]) : ''; };
  // O valor efetivamente pago (após descontos) tem prioridade sobre o "valor total" bruto.
  const total = pick(/(?:valor a pagar|total a pagar|valor pago)[^\d]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/)
    || pick(/valor total[^\d]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/)
    || pick(/\btotal\b[^\d]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/);
  const discount = pick(/desconto[s]?[^\d]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/);
  const storeLine = lines.find((l) => /[a-z]{3}/i.test(l) && !/cnpj|cpf|rua|av\.|avenida|cep|documento|nfc|danfe|consumidor/i.test(l)) || '';
  const items: ReceiptItem[] = [];
  lines.forEach((line, i) => {
    const n = norm(line);
    if (SKIP.test(n)) return;
    const values = [...line.matchAll(MONEY)].map((m) => m[1]);
    if (!values.length) return;
    // Descrição: texto antes das quantidades/valores, sem número do item e código de barras.
    const description = line
      .replace(MONEY, ' ')
      .replace(/^\s*\d{1,3}\s+/, '')
      .replace(/\b\d{6,14}\b/g, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:un|und|kg|g|l|ml|pc|pct|cx|fd)\b\.?/gi, ' ')
      .replace(/\b(?:x|vl\.?\s*unit|vl\.?\s*total|qtde?|un)\b/gi, ' ')
      .replace(/[*#|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!/[a-z]{3}/i.test(description)) return;
    const amount = toDec(values.at(-1)!);
    if (cents(amount) <= 0n) return;
    items.push({ key: `item-${i + 1}`, description: description.slice(0, 80), amount, category: productCategory(description, memory) });
  });
  return { store: storeLine.slice(0, 80), date, total, discount, items };
}

/**
 * Reparte o desconto entre os itens proporcionalmente (centavos; resto no maior item) e agrupa por
 * categoria. A soma das partes é exatamente `paid` (valor pago, igual ao lançamento).
 */
export function receiptParts(items: { description: string; amount: string; category: string }[], paid: string) {
  const amounts = items.map((i) => cents(i.amount));
  const gross = amounts.reduce((n, v) => n + v, 0n);
  const target = cents(paid);
  if (gross <= 0n || target <= 0n) return [];
  // Maiores restos: cada centavo que sobrou vai para o item que mais perdeu no arredondamento.
  const scaled = amounts.map((v) => (v * target) / gross);
  const fraction = amounts.map((v) => (v * target) % gross);
  let rest = target - scaled.reduce((n, v) => n + v, 0n);
  const order = amounts.map((_, i) => i).sort((a, b) => (fraction[b] > fraction[a] ? 1 : fraction[b] < fraction[a] ? -1 : a - b));
  for (let k = 0; rest > 0n; k = (k + 1) % order.length) { scaled[order[k]] += 1n; rest -= 1n; }
  const groups = new Map<string, { amount: bigint; names: string[] }>();
  items.forEach((it, i) => {
    const g = groups.get(it.category) || { amount: 0n, names: [] };
    g.amount += scaled[i]; g.names.push(it.description); groups.set(it.category, g);
  });
  return [...groups.entries()].filter(([, g]) => g.amount > 0n).map(([category, g]) => ({ category, amount: decimal(g.amount), description: g.names.join(', ').slice(0, 160) }));
}
