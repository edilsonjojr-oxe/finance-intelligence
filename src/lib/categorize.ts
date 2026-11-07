// Categorização automática em dois níveis ("Grupo / Subcategoria"): primeiro o que o próprio
// usuário já decidiu para o mesmo estabelecimento (memória), depois regras por palavras-chave.
// Sempre editável na revisão e depois de confirmado.

export const UNCATEGORIZED = 'Sem categoria';
export const SEPARATOR = ' / ';

/** Grupos e subcategorias prontos. As personalizadas do usuário se somam a estes. */
export const categoryTree: Record<string, string[]> = {
  'Alimentação': ['Mercado', 'Delivery', 'Restaurantes e lanches', 'Padaria e café', 'Bebidas'],
  'Casa': ['Cama, mesa e banho', 'Limpeza', 'Utensílios e decoração', 'Manutenção', 'Móveis e eletrodomésticos'],
  'Moradia': ['Aluguel e condomínio', 'Luz, água e gás', 'Internet e telefone', 'IPTU'],
  'Transporte': ['Apps de corrida', 'Combustível', 'Estacionamento e pedágio', 'Transporte público', 'Veículo'],
  'Saúde': ['Farmácia', 'Consultas e exames', 'Plano de saúde', 'Academia'],
  'Cuidados pessoais': ['Higiene', 'Beleza'],
  'Compras': ['Online', 'Vestuário', 'Eletrônicos', 'Presentes'],
  'Lazer': ['Passeios e eventos', 'Jogos', 'Hobbies'],
  'Viagem': ['Hospedagem', 'Passagens', 'Passeios'],
  'Assinaturas': ['Streaming', 'Software e apps'],
  'Educação': ['Escola e cursos', 'Livros e material'],
  'Pets': ['Ração e petshop', 'Veterinário'],
  'Impostos e taxas': ['Impostos', 'Tarifas bancárias', 'Juros e encargos'],
  'Dívidas e empréstimos': ['Parcelas de empréstimo', 'Acordos', 'Financiamentos', 'Fatura de cartão'],
  'Doações': [],
  'Outros': [],
  'Receitas': ['Salário', 'Investimentos', 'Reembolsos e estornos', 'Empréstimos a receber', 'Outras receitas'],
};
const path = (group: string, sub?: string) => (sub ? `${group}${SEPARATOR}${sub}` : group);
export const defaultCategories: string[] = Object.entries(categoryTree).flatMap(([group, subs]) =>
  subs.length ? subs.map((s) => path(group, s)) : [group],
);

/** Grupo de uma categoria ("Alimentação / Mercado" → "Alimentação"). */
export const categoryGroup = (name: string) => name.split(SEPARATOR)[0].trim();
export const categorySub = (name: string) => name.split(SEPARATOR).slice(1).join(SEPARATOR).trim();

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Ordem importa: a primeira regra que casar vence (delivery antes de corrida e de mercado).
const rules: [string, RegExp][] = [
  [path('Dívidas e empréstimos', 'Fatura de cartão'), /^(?:cartao|fatura)\b|pagamento (?:de )?fatura|pgto fatura/],
  [path('Dívidas e empréstimos', 'Acordos'), /\bacordo\b|renegocia|\bdividas?\b/],
  [path('Dívidas e empréstimos', 'Parcelas de empréstimo'), /emprestimo|consignado|credito pessoal/],
  [path('Dívidas e empréstimos', 'Financiamentos'), /financiamento/],
  [path('Alimentação', 'Delivery'), /\bifd\b|ifd\*|ifood|99 ?food|dl\*99|keeta|rappi|aiqfome|ze ?delivery|uber ?\*? ?eats|james delivery|delivery much/],
  [path('Transporte', 'Apps de corrida'), /\buber\b|99 ?(?:app|pop|taxi|tecnologia)|\b99\*|cabify|indriver|\btaxi\b|garupa/],
  [path('Assinaturas', 'Streaming'), /netflix|spotify|disney|hbo|globoplay|paramount|deezer|youtube ?premium|prime ?video|amazon ?prime|crunchyroll|star ?plus|tidal|audible|apple ?tv|kindle unlimited/],
  [path('Assinaturas', 'Software e apps'), /apple\.com|icloud|google ?(?:one|storage|play)|chatgpt|openai|adobe|microsoft ?365|canva|dropbox|notion|claude\.ai|anthropic/],
  [path('Alimentação', 'Padaria e café'), /padaria|confeitaria|panificadora|cafeteria|\bcafe\b|starbucks|doceria|sorveteria|acai/],
  [path('Alimentação', 'Restaurantes e lanches'), /restaurante|lanchonete|lancheria|pizzaria|hamburgu|burger|mc ?donald|subway|outback|churrascaria|sushi|bistro|\blanches?\b|\bbar\b e|petiscaria|galeteria|buffet/],
  [path('Alimentação', 'Mercado'), /supermercado|\bmercado\b|mercearia|atacad|assai|carrefour|pao de acucar|zaffari|\bnacional\b|hortifruti|sacolao|acougue|bourbon|walmart|makro|fort atacadista|super ?nosso|unidasul|asun|stok center|\bbig\b/],
  [path('Transporte', 'Combustível'), /\bposto\b|shell|ipiranga|petrobras|br mania|combustiv|gasolina|etanol|\bgnv\b/],
  [path('Transporte', 'Estacionamento e pedágio'), /estacionament|pedagio|sem parar|conectcar|veloe|estapar|zul digital|multipark|parking/],
  [path('Transporte', 'Transporte público'), /\bmetro\b|onibus|trensurb|bilhete unico|\btri\b|carris|blablacar|rodoviaria/],
  [path('Saúde', 'Farmácia'), /farmacia|drogaria|panvel|droga ?raia|drogasil|pague menos|sao joao farm|\bdrogas?\b|ultrafarma/],
  [path('Saúde', 'Academia'), /academia|smart ?fit|bodytech|gympass|wellhub|crossfit|pilates/],
  [path('Saúde', 'Plano de saúde'), /unimed|amil|bradesco saude|sulamerica saude|hapvida|notredame|plano de saude/],
  [path('Saúde', 'Consultas e exames'), /hospital|clinica|laboratorio|odonto|dentist|medic[oa]|exame|fisioterap|psicolog/],
  [path('Educação', 'Escola e cursos'), /escola|colegio|faculdade|universidade|\bcurso\b|udemy|alura|coursera|duolingo|mensalidade escolar/],
  [path('Educação', 'Livros e material'), /livraria|saraiva|papelaria|kalunga/],
  [path('Moradia', 'Internet e telefone'), /\bvivo\b|\bclaro\b|\btim\b|\bnet\b|internet|telefonica|fibra|banda larga|starlink/],
  [path('Moradia', 'Luz, água e gás'), /energia|\bluz\b|ceee|cemig|\blight\b|enel|cpfl|copel|celesc|equatorial|rge|\bagua\b|corsan|sabesp|dmae|\bgas\b|comgas|ultragaz|supergasbras/],
  [path('Moradia', 'Aluguel e condomínio'), /aluguel|condominio|imobiliaria/],
  [path('Moradia', 'IPTU'), /\biptu\b/],
  [path('Viagem', 'Hospedagem'), /hotel|pousada|airbnb|booking|hostel|hurb/],
  [path('Viagem', 'Passagens'), /latam|gol linhas|voegol|azul linhas|voeazul|decolar|123 ?milhas|maxmilhas|passagem/],
  [path('Lazer', 'Passeios e eventos'), /cinema|cinemark|ingresso|sympla|eventim|\bshow\b|teatro|parque|clube/],
  [path('Lazer', 'Jogos'), /steam|playstation|\bpsn\b|xbox|nintendo|epic games/],
  [path('Pets', 'Veterinário'), /veterinar/],
  [path('Pets', 'Ração e petshop'), /petshop|pet shop|\bpet\b|cobasi|petz|racao/],
  [path('Cuidados pessoais', 'Beleza'), /salao|barbearia|cabeleireir|estetica|manicure|boticario|\bnatura\b|sephora|\bavon\b|eudora|perfumaria/],
  [path('Casa', 'Cama, mesa e banho'), /camicado|cama ?mesa|toalha|lencol|edredom|travesseiro|cortina/],
  [path('Casa', 'Utensílios e decoração'), /tok ?& ?stok|etna|havan|leroy merlin|utilidades|decorac/],
  [path('Compras', 'Vestuário'), /renner|riachuelo|\bc ?& ?a\b|\bcea\b|zara|hering|centauro|netshoes|nike|adidas|marisa|youcom|calcados|sapataria|arezzo/],
  [path('Compras', 'Eletrônicos'), /kabum|fast shop|samsung|apple store|dell|lenovo|xiaomi/],
  [path('Compras', 'Online'), /amazon|mercado ?livre|mercadolivre|mercadopago\*ml|shopee|aliexpress|magalu|magazine luiza|americanas|shein|casas bahia|ponto frio|temu/],
  [path('Impostos e taxas', 'Tarifas bancárias'), /tarifa|anuidade|\biof\b|cesta de servicos|taxa de manutencao/],
  [path('Impostos e taxas', 'Juros e encargos'), /juros|encargo|\bmulta\b|\bmora\b|rotativo|parcelamento de fatura/],
  [path('Impostos e taxas', 'Impostos'), /\bipva\b|\bdarf\b|imposto|\bdas\b simples|licenciamento|detran|receita federal/],
  ['Doações', /doacao|vakinha|dizimo|oferta/],
  [path('Compras', 'Presentes'), /presente|floricultura|kopenhagen|cacau show/],
];
const incomeRules: [string, RegExp][] = [
  [path('Receitas', 'Salário'), /salario|folha de pagamento|pagamento de salario|proventos|vencimentos|\bpro ?labore\b/],
  [path('Receitas', 'Investimentos'), /rendimento|dividendo|\bjcp\b|resgate/],
  [path('Receitas', 'Reembolsos e estornos'), /estorno|reembolso|cashback|devolucao|credito/],
];

/**
 * Chave do estabelecimento para a memória: sem acentos, números, parcelas e sufixos de
 * cidade/código, até 3 palavras. "IFD*RESTAURANTE X PARC 02/03" e "Ifd*Restaurante X"
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
    .filter((i) => i.category && i.category !== UNCATEGORIZED && i.category !== 'Transferência interna' && i.category !== DIVIDED && i.status !== 'reversed')
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
  if (kind === 'income') return path('Receitas', 'Outras receitas');
  // O texto é o próprio nome de um grupo ou subcategoria (ex.: categoria vinda de planilha).
  for (const [group, subs] of Object.entries(categoryTree)) {
    if (normalize(group) === text.trim()) return group;
    const sub = subs.find((x) => normalize(x) === text.trim());
    if (sub) return path(group, sub);
  }
  return UNCATEGORIZED;
}

/** Categoria exibida para um lançamento dividido entre várias categorias. */
export const DIVIDED = 'Dividido';

/** Lista para os seletores: prontas + personalizadas + já usadas, sem repetição. */
export function categoryList(custom: string[] = [], used: string[] = []) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [UNCATEGORIZED, ...defaultCategories, ...custom, ...used]) {
    const clean = name.trim();
    if (!clean || clean === 'Transferência interna' || clean === DIVIDED || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

/** Normaliza o separador digitado pelo usuário ("Casa/Limpeza", "Casa > Limpeza"). */
export function cleanCategory(value: string) {
  return value
    .split(/\s*(?:\/|>|›)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(SEPARATOR)
    .slice(0, 80);
}
