// Categorização automática: primeiro o que o próprio usuário já decidiu para o mesmo
// estabelecimento (memória), depois regras por palavras-chave. Sempre editável na revisão.

export const UNCATEGORIZED = 'Sem categoria';

/** Categorias prontas. As personalizadas do usuário se somam a estas. */
export const defaultCategories = [
  'Alimentação', 'Supermercado', 'Moradia', 'Contas da casa', 'Transporte', 'Combustível',
  'Saúde', 'Farmácia', 'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Internet',
  'Compras', 'Vestuário', 'Pets', 'Beleza e cuidados', 'Presentes e doações', 'Serviços',
  'Impostos', 'Tarifas bancárias', 'Juros e encargos', 'Salário', 'Outras receitas',
  'Investimentos', 'Outros',
] as const;

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Ordem importa: a primeira regra que casar vence.
const rules: [string, RegExp][] = [
  ['Assinaturas', /netflix|spotify|disney|hbo|globoplay|paramount|deezer|youtube ?premium|prime ?video|amazon ?prime|apple\.com|icloud|google ?(?:one|storage)|chatgpt|openai|adobe|microsoft ?365|canva|crunchyroll|star ?plus|tidal|audible|kindle unlimited/],
  ['Alimentação', /ifood|rappi|aiqfome|restaurante|lanchonete|lancheria|pizzaria|hamburgu|burger|mc ?donald|subway|outback|starbucks|cafeteria|\bcafe\b|padaria|confeitaria|churrascaria|sushi|bistro|acai|sorveteria|doceria|\blanches?\b/],
  ['Supermercado', /supermercado|\bmercado\b|atacad|assai|carrefour|pao de acucar|zaffari|nacional|hortifruti|sacolao|acougue|bourbon|\bdia\b supermercado|walmart|makro|fort atacadista|super ?nosso/],
  ['Combustível', /\bposto\b|shell|ipiranga|petrobras|br mania|combustiv|gasolina|etanol|\bgnv\b/],
  ['Transporte', /\buber\b|99 ?(?:app|pop|taxi)|cabify|\btaxi\b|estacionament|pedagio|sem parar|conectcar|veloe|\bmetro\b|onibus|trensurb|bilhete unico|blablacar|zul digital|estapar/],
  ['Farmácia', /farmacia|drogaria|panvel|droga ?raia|drogasil|pague menos|sao joao farm|\bdrogas?\b|ultrafarma/],
  ['Saúde', /hospital|clinica|laboratorio|unimed|odonto|dentist|medic[oa]|exame|fisioterap|psicolog|\bsaude\b|amil|bradesco saude|sulamerica saude|hapvida/],
  ['Educação', /escola|colegio|faculdade|universidade|\bcurso\b|udemy|alura|coursera|duolingo|livraria|saraiva|mensalidade escolar/],
  ['Internet', /\bvivo\b|\bclaro\b|\btim\b|\bnet\b|internet|telefonica|fibra|banda larga|starlink/],
  ['Contas da casa', /energia|\bluz\b|ceee|cemig|\blight\b|enel|cpfl|copel|celesc|equatorial|\bagua\b|corsan|sabesp|dmae|\bgas\b|comgas|ultragaz|supergasbras/],
  ['Moradia', /aluguel|condominio|imobiliaria|\biptu\b/],
  ['Viagem', /hotel|pousada|airbnb|booking|latam|gol linhas|voegol|azul linhas|voeazul|decolar|123 ?milhas|hurb|maxmilhas|rodoviaria|passagem/],
  ['Lazer', /cinema|cinemark|ingresso|sympla|eventim|\bshow\b|teatro|steam|playstation|\bpsn\b|xbox|nintendo|parque|clube|academia|smart ?fit|bodytech|gympass|wellhub/],
  ['Pets', /petshop|pet shop|\bpet\b|cobasi|petz|veterinar|racao/],
  ['Beleza e cuidados', /salao|barbearia|cabeleireir|estetica|manicure|boticario|natura|sephora|avon|eudora|perfumaria/],
  ['Vestuário', /renner|riachuelo|\bc ?& ?a\b|\bcea\b|zara|hering|centauro|netshoes|nike|adidas|marisa|youcom|calcados|sapataria|arezzo/],
  ['Compras', /amazon|mercado ?livre|mercadolivre|mercadopago\*ml|shopee|aliexpress|magalu|magazine luiza|americanas|shein|casas bahia|ponto frio|kabum|leroy merlin|tok ?& ?stok|temu/],
  ['Tarifas bancárias', /tarifa|anuidade|\biof\b|cesta de servicos|taxa de manutencao/],
  ['Juros e encargos', /juros|encargo|\bmulta\b|\bmora\b|rotativo|parcelamento de fatura/],
  ['Impostos', /\bipva\b|\bdarf\b|imposto|\bdas\b simples|licenciamento|detran|receita federal/],
  ['Presentes e doações', /doacao|vakinha|presente|floricultura|kopenhagen|cacau show/],
  ['Investimentos', /aplicacao|investimento|tesouro direto|\bcdb\b|corretora/],
];
const incomeRules: [string, RegExp][] = [
  ['Salário', /salario|folha de pagamento|pagamento de salario|proventos|vencimentos|\bpro ?labore\b/],
  ['Investimentos', /rendimento|dividendo|\bjcp\b|resgate/],
];

/**
 * Chave do estabelecimento para a memória: sem acentos, números, parcelas e sufixos de
 * cidade/código, até 3 palavras. "IFOOD *RESTAURANTE X PARC 02/03" e "Ifood *Restaurante X"
 * viram a mesma chave.
 */
export function merchantKey(description: string) {
  const words = normalize(description)
    .replace(/parc(?:ela)?\.?\s*\d+\s*\/\s*\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'com', 'pg', 'pag', 'compra', 'debito', 'credito'].includes(w));
  return words.slice(0, 3).join(' ');
}

export type CategoryMemory = Map<string, string>;

/** Memória a partir dos lançamentos já confirmados (o mais recente com categoria vence). */
export function buildMemory(
  items: { description: string; category: string; date?: string; status?: string }[],
): CategoryMemory {
  const memory: CategoryMemory = new Map();
  const sorted = [...items]
    .filter((i) => i.category && i.category !== UNCATEGORIZED && i.category !== 'Transferência interna' && i.status !== 'reversed')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const item of sorted) {
    const key = merchantKey(item.description);
    if (key) memory.set(key, item.category);
  }
  return memory;
}

export function suggestCategory(
  description: string,
  kind: 'income' | 'expense' = 'expense',
  memory?: CategoryMemory,
): string {
  const key = merchantKey(description);
  const remembered = key ? memory?.get(key) : undefined;
  if (remembered) return remembered;
  const text = normalize(description);
  for (const [category, pattern] of kind === 'income' ? incomeRules : rules)
    if (pattern.test(text)) return category;
  if (kind === 'income' && /estorno|reembolso|cashback|credito/.test(text)) return 'Outras receitas';
  return UNCATEGORIZED;
}

/** Lista para os seletores: prontas + personalizadas + já usadas, sem repetição. */
export function categoryList(custom: string[] = [], used: string[] = []) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [UNCATEGORIZED, ...defaultCategories, ...custom, ...used]) {
    const clean = name.trim();
    if (!clean || clean === 'Transferência interna' || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}
