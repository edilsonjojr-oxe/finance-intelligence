// Cartão como conta, compras lidas de fatura, pagamento por transferência, categorias.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, requireUser } from "../src/server/auth";
import { database } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { addDays, localToday } from "../src/lib/money";
import { forecast, totals } from "../src/lib/finance";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-cards-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const today = localToday(), d10 = addDays(today, -10), d5 = addDays(today, -5);
  const user = (await requireUser(await authenticate("setup", "cartao@exemplo.invalid", "Senha-sintetica-123!", "Pessoa"))).id;

  const checking = await financeAction(user, "account.create", { name: "Conta corrente", institution: "Banco X", type: "checking", opening_balance: "5000.00", opening_date: addDays(today, -30) });
  const card = await financeAction(user, "account.create", {
    name: "Banco do Brasil Mastercard Maria •4821", institution: "Banco do Brasil", type: "credit_card", opening_balance: "0", opening_date: d10,
    card_brand: "Mastercard", card_holder: "Maria Regiane", card_last4: "4821", closing_day: "1", due_day: "10", credit_limit: "8000.00",
  });
  let state = await getFinance(user);
  const c = state.accounts.find((a) => a.id === card.id)!;
  assert.equal(c.type, "credit_card");
  assert.equal(c.card_holder, "Maria Regiane");
  assert.equal(c.card_last4, "4821");
  assert.equal(c.due_day, 10);
  assert.equal(c.credit_limit, "8000.00");
  await assert.rejects(() => financeAction(user, "account.create", { name: "x", type: "credit_card", opening_balance: "0", opening_date: today, card_last4: "12" }), /4 últimos/);
  pass("Cartão cadastrado com banco, bandeira, titular, final, vencimento e limite");

  const hashHex = "a".repeat(64);
  const r = await financeAction(user, "intake.confirm", {
    source_type: "document", source_hash: hashHex, account_id: card.id,
    items: [
      { key: "card-1", description: "IFOOD *RESTAURANTE", amount: "80.00", date: d10, kind: "expense", category: "Alimentação", event_type: "paid" },
      { key: "card-2", description: "NETFLIX.COM", amount: "55.90", date: d5, kind: "expense", category: "Assinaturas", event_type: "paid" },
      { key: "card-3", description: "ESTORNO LOJA", amount: "20.00", date: d5, kind: "income", category: "Outras receitas", event_type: "paid" },
    ],
  }) as { count: number };
  assert.equal(r.count, 3);
  state = await getFinance(user);
  assert.equal(state.accounts.find((a) => a.id === card.id)!.balance, "-115.90");
  assert.ok(state.transactions.filter((t) => t.account_id === card.id).every((t) => t.status === "posted"));
  const again = await financeAction(user, "intake.confirm", { source_type: "document", source_hash: hashHex, account_id: card.id, items: [{ key: "card-1", description: "IFOOD *RESTAURANTE", amount: "80.00", date: d10, kind: "expense", category: "Alimentação", event_type: "paid" }] }) as { skipped: number };
  assert.equal(again.skipped, 1);
  pass("Compras da fatura entram no cartão; estorno abate; reler a mesma fatura não duplica");

  const month = today.slice(0, 7);
  const before = totals(state.transactions, month);
  await financeAction(user, "movement.create", { account_id: checking.id, destination_account_id: card.id, kind: "transfer", amount: "115.90", date: today, competence: today, description: "Pagamento fatura", category: "Transferência interna" });
  state = await getFinance(user);
  assert.equal(state.accounts.find((a) => a.id === card.id)!.balance, "0.00");
  assert.equal(state.accounts.find((a) => a.id === checking.id)!.balance, "4884.10");
  assert.deepEqual(totals(state.transactions, month), before, "Pagamento da fatura não conta como nova despesa");
  pass("Pagamento da fatura é transferência: zera o cartão sem duplicar despesa");

  await financeAction(user, "intake.confirm", { source_type: "document", source_hash: "b".repeat(64), account_id: card.id, items: [{ key: "card-1", description: "POSTO SHELL", amount: "200.00", date: d5, kind: "expense", category: "Combustível", event_type: "paid" }] });
  state = await getFinance(user);
  const proj = forecast(state.accounts, state.obligations, state.today, 40);
  assert.equal(proj[0].balance, "4884.10", "Saldo disponível não inclui dívida do cartão");
  assert.equal(proj.at(-1)!.balance, "4684.10", "Fatura sai uma vez, no vencimento");
  pass("Projeção desconta a fatura no vencimento, uma única vez");

  await financeAction(user, "account.update", { id: card.id, name: "Cartão da Maria", institution: "Banco do Brasil", card_brand: "Mastercard", card_holder: "Maria Regiane", card_last4: "4821", due_day: "15" });
  state = await getFinance(user);
  assert.equal(state.accounts.find((a) => a.id === card.id)!.name, "Cartão da Maria");
  assert.equal(state.accounts.find((a) => a.id === card.id)!.due_day, 15);
  await financeAction(user, "account.update", { id: checking.id, name: "Conta principal", card_last4: "9999" });
  assert.equal((await getFinance(user)).accounts.find((a) => a.id === checking.id)!.card_last4, null, "Conta comum não guarda dados de cartão");
  pass("Nome e dados do cartão editáveis");

  await financeAction(user, "category.create", { name: "Escola das crianças" });
  await financeAction(user, "category.create", { name: "Escola das crianças" });
  assert.deepEqual((await getFinance(user)).categories, ["Escola das crianças"]);
  await financeAction(user, "category.delete", { name: "Escola das crianças" });
  assert.deepEqual((await getFinance(user)).categories, []);
  pass("Categorias personalizadas criadas e removidas, sem duplicar");

  const batch = await financeAction(user, "import.stage", { account_id: checking.id, filename: "extrato.csv", format: "csv", content: `data;descricao;valor\n${d5};NETFLIX.COM;-55,90\n${d5};POSTO SHELL CENTRO;-120,00\n${d5};LOJA DESCONHECIDA;-10,00` });
  const cands = (await getFinance(user)).candidates.filter((x) => x.batch_id === batch.id);
  assert.deepEqual(cands.map((x) => x.category).sort(), ["Assinaturas", "Combustível", "Sem categoria"]);
  pass("Importação CSV sugere categoria pela memória e pelas regras");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("7 cenários de cartões e categorias aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
