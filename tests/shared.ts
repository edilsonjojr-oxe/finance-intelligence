// Despesas compartilhadas: conexões, isolamento (RLS), modos de divisão, lançamento no ledger
// de cada um sem dupla contagem, acerto, edição e exclusão. Somente dados sintéticos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, createInvite, requireUser } from "../src/server/auth";
import { database, transaction } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { addDays, localToday } from "../src/lib/money";
import { totals } from "../src/lib/finance";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-shared-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const pw = "Senha-sintetica-123!", today = localToday(), month = today.slice(0, 7);
  const A = (await requireUser(await authenticate("setup", "a@exemplo.invalid", pw, "Ana"))).id;
  const B = (await requireUser(await authenticate("register", "b@exemplo.invalid", pw, "Bruno", (await createInvite(A)).code))).id;
  const C = (await requireUser(await authenticate("register", "c@exemplo.invalid", pw, "Carla", (await createInvite(A)).code))).id;
  const accA = (await financeAction(A, "account.create", { name: "Conta A", type: "checking", opening_balance: "5000.00", opening_date: addDays(today, -60) })).id;
  const accB = (await financeAction(B, "account.create", { name: "Conta B", type: "checking", opening_balance: "3000.00", opening_date: addDays(today, -60) })).id;
  const bal = async (u: string, id: string) => (await getFinance(u)).accounts.find((a) => a.id === id)!.balance;
  const receivable = async (u: string) => (await getFinance(u)).accounts.find((a) => a.type === "receivable")?.balance || "0.00";

  // 1. Conexões: resposta neutra, aceite, só conectados entram em grupo.
  const neutral = (await financeAction(A, "connect.request", { email: "b@exemplo.invalid" }) as unknown as { message: string }).message;
  assert.equal((await financeAction(A, "connect.request", { email: "ninguem@exemplo.invalid" }) as unknown as { message: string }).message, neutral);
  const reqB = (await getFinance(B)).shared.connections.find((c) => c.incoming)!;
  assert.equal(reqB.name, "Ana");
  await assert.rejects(() => financeAction(A, "connect.respond", { id: reqB.id, accept: true }), /não encontrado/);
  await financeAction(B, "connect.respond", { id: reqB.id, accept: true });
  await assert.rejects(() => financeAction(A, "group.create", { name: "X", member_user_ids: [C] }), /conectadas/);
  pass("Conexão por e-mail com resposta neutra, aceite só pelo destinatário; grupo só com conectados");

  const casa = (await financeAction(A, "group.create", { name: "Casa", member_user_ids: [B] })).id;
  const g = () => getFinance(A).then((s) => s.shared.groups.find((x) => x.id === casa)!);
  const [mA, mB] = (await g()).members.map((m) => m.id);

  // 2. Aluguel 300, Ana paga, 50/50.
  const aluguel = (await financeAction(A, "shared.create", { group_id: casa, description: "Aluguel", total: "300.00", date: today, category: "Moradia / Aluguel e condomínio", payer_member_id: mA, mode: "equal", account_id: accA })).id;
  assert.equal(await bal(A, accA), "4700.00", "Conta da Ana sai 300, como no banco");
  assert.equal(await receivable(A), "150.00", "150 ficam a receber");
  let sA = await getFinance(A);
  assert.equal(totals(sA.transactions, month).expense, "150.00", "Só a parte da Ana conta como despesa");
  let sB = await getFinance(B);
  assert.equal(sB.shared.inbox.length, 1);
  assert.equal(totals(sB.transactions, month).expense, "0.00");
  await financeAction(B, "shared.post", { expense_id: aluguel });
  sB = await getFinance(B);
  const obB = sB.obligations.find((o) => o.description.startsWith("Aluguel"))!;
  assert.deepEqual([obB.amount, obB.status, obB.kind], ["150.00", "open", "expense"]);
  assert.ok(obB.description.includes("pagar para Ana"));
  assert.equal(sB.shared.inbox.length, 0);
  pass("Eu pago 300 em 50/50: saldo -300, despesa 150, 150 a receber; parte do outro vira compromisso no ledger dele");

  // 3. Isolamento: Carla não vê nada do grupo (RLS com papel restrito); ação recusada.
  await transaction(A, async (db) => {
    await db.query("CREATE ROLE fi_shared_restricted NOLOGIN NOSUPERUSER NOBYPASSRLS");
    await db.query("GRANT SELECT ON shared_expenses, shared_shares, share_members, share_groups TO fi_shared_restricted");
    await db.query("GRANT EXECUTE ON FUNCTION fi_is_member(uuid) TO fi_shared_restricted");
    await db.query("SET LOCAL ROLE fi_shared_restricted");
    assert.equal((await db.query("SELECT id FROM shared_expenses")).rows.length, 1);
    await db.query("SELECT set_config('app.user_id',$1,true)", [C]);
    for (const t of ["shared_expenses", "shared_shares", "share_members", "share_groups"])
      assert.equal((await db.query(`SELECT 1 FROM ${t}`)).rows.length, 0, `Carla não vê ${t}`);
  });
  await assert.rejects(() => financeAction(C, "shared.post", { expense_id: aluguel }), /não participa/);
  assert.equal((await getFinance(C)).shared.groups.length, 0);
  pass("Usuário fora do grupo não vê despesas, partes, membros nem grupo (RLS) e não consegue lançar");

  // 4. Caso inverso: Bruno paga 100 do mercado, 50/50.
  const mercado = (await financeAction(B, "shared.create", { group_id: casa, description: "Mercado", total: "100.00", date: today, category: "Alimentação / Mercado", payer_member_id: mB, mode: "equal", account_id: accB })).id;
  assert.equal(await bal(B, accB), "2900.00");
  assert.equal(totals((await getFinance(B)).transactions, month).expense, "50.00");
  sA = await getFinance(A);
  assert.equal(sA.shared.inbox.find((i) => i.expense_id === mercado)!.my_share, "50.00");
  await financeAction(A, "shared.post", { expense_id: mercado });
  const balances = (await g()).balances;
  assert.deepEqual([balances[mA], balances[mB]], ["100.00", "-100.00"], "Ana tem 100 a receber líquido");
  pass("Ele paga: espelho do caso anterior; saldo líquido do grupo correto");

  // 5. Modos de divisão, arredondamento e soma diferente do total.
  const reqC = (await financeAction(A, "connect.request", { email: "c@exemplo.invalid" }), (await getFinance(C)).shared.connections.find((c) => c.incoming)!);
  await financeAction(C, "connect.respond", { id: reqC.id, accept: true });
  const reqBC = (await financeAction(B, "connect.request", { email: "c@exemplo.invalid" }), (await getFinance(C)).shared.connections.find((c) => c.incoming)!);
  await financeAction(C, "connect.respond", { id: reqBC.id, accept: true });
  const trio = (await financeAction(A, "group.create", { name: "Trio", kind: "event", member_user_ids: [B, C] })).id;
  const tg = (await getFinance(A)).shared.groups.find((x) => x.id === trio)!;
  const [tA, tB, tC] = tg.members.map((m) => m.id);
  const shares = async (exp: string) => (await getFinance(A)).shared.groups.find((x) => x.id === trio)!.expenses.find((e) => e.id === exp)!.shares;
  const e1 = (await financeAction(A, "shared.create", { group_id: trio, description: "Pizza", total: "100.00", date: today, category: "Alimentação / Delivery", payer_member_id: tA, mode: "equal", account_id: accA })).id;
  assert.deepEqual([(await shares(e1))[tA], (await shares(e1))[tB], (await shares(e1))[tC]], ["33.34", "33.33", "33.33"]);
  const e2 = (await financeAction(A, "shared.create", { group_id: trio, description: "Uber", total: "60.00", date: today, category: "Transporte / Apps de corrida", payer_member_id: tB, mode: "selected", selected: [tB, tC] })).id;
  assert.deepEqual([(await shares(e2))[tA], (await shares(e2))[tB], (await shares(e2))[tC]], ["0.00", "30.00", "30.00"]);
  const e3 = (await financeAction(A, "shared.create", { group_id: trio, description: "Show", total: "300.00", date: today, category: "Lazer", payer_member_id: tC, mode: "exact", exact: { [tA]: "100", [tB]: "150", [tC]: "50" } })).id;
  assert.deepEqual([(await shares(e3))[tA], (await shares(e3))[tB], (await shares(e3))[tC]], ["100.00", "150.00", "50.00"]);
  await assert.rejects(() => financeAction(A, "shared.create", { group_id: trio, description: "Errado", total: "300.00", date: today, payer_member_id: tC, mode: "exact", exact: { [tA]: "100", [tB]: "150", [tC]: "20" } }), /Falta distribuir R\$ 30,00/);
  const e4 = (await financeAction(A, "shared.create", { group_id: trio, description: "Bar", total: "10.00", date: today, payer_member_id: tC, mode: "percent", percent: { [tA]: "50", [tB]: "25", [tC]: "25" } })).id;
  assert.deepEqual([(await shares(e4))[tA], (await shares(e4))[tB], (await shares(e4))[tC]], ["5.00", "2.50", "2.50"]);
  assert.equal(totals((await getFinance(A)).transactions, month).expense, "183.34", "Ana: 150 + 33,34 (pizza); Uber/Show/Bar ainda não lançados");
  pass("Igual (33,34+33,33+33,33), só selecionados, valores exatos, percentual; soma diferente do total recusada");

  // 6. Acerto: Bruno paga o que deve à Ana no grupo Casa; Ana confirma.
  const settle = (await financeAction(B, "settle.pay", { group_id: casa, to_member_id: mA, account_id: accB, date: today })) as { id: string; amount: string };
  assert.equal(settle.amount, "150.00");
  sB = await getFinance(B);
  assert.equal(sB.obligations.find((o) => o.id === obB.id)!.status, "paid");
  assert.equal(totals(sB.transactions, month).expense, "200.00", "Bruno: 50 (mercado) + 150 (aluguel) ao quitar");
  await assert.rejects(() => financeAction(B, "settle.confirm", { id: settle.id, account_id: accB }), /Só quem recebeu/);
  const incomeBefore = totals((await getFinance(A)).transactions, month).income;
  await financeAction(A, "settle.confirm", { id: settle.id, account_id: accA });
  assert.equal(await receivable(A), "66.66", "Resta só a pizza do outro grupo (100 - 33,34 da Ana)");
  assert.equal(totals((await getFinance(A)).transactions, month).income, incomeBefore, "Reembolso não é receita");
  pass("Acerto: quem paga quita no próprio ledger; quem recebe confirma e baixa o a receber sem virar receita");

  // 7. Edição depois de quitada → aviso; exclusão com parte em aberto → compromisso cancelado.
  await assert.rejects(() => financeAction(B, "shared.update", { id: aluguel, description: "Aluguel", total: "400.00", date: today, payer_member_id: mA, mode: "equal" }), /Só quem lançou/);
  await financeAction(A, "shared.update", { id: aluguel, description: "Aluguel", total: "400.00", date: today, category: "Moradia / Aluguel e condomínio", payer_member_id: mA, mode: "equal" });
  sA = await getFinance(A);
  // 5000 - 400 (aluguel corrigido; o de 300 foi estornado) - 100 (pizza) + 150 (reembolso) = 4650
  assert.equal(sA.accounts.find((a) => a.id === accA)!.balance, "4650.00");
  assert.equal(sA.accounts.find((a) => a.type === "receivable")!.balance, "116.66", "Bruno passa a dever mais 50; pizza 66,66");
  assert.equal(totals(sA.transactions, month).expense, "233.34", "Despesa da Ana: 200 (nova parte) + 33,34");
  sB = await getFinance(B);
  assert.ok(sB.shared.notices.some((n) => n.notice.includes("alterada depois que você pagou")));
  const lanche = (await financeAction(A, "shared.create", { group_id: casa, description: "Lanche", total: "60.00", date: today, payer_member_id: mA, mode: "equal", account_id: accA })).id;
  await financeAction(B, "shared.post", { expense_id: lanche });
  const obLanche = (await getFinance(B)).obligations.find((o) => o.description.startsWith("Lanche"))!;
  await financeAction(A, "shared.delete", { id: lanche });
  const afterDel = await getFinance(B);
  assert.equal(afterDel.obligations.find((o) => o.id === obLanche.id)!.status, "cancelled");
  pass("Só quem criou edita; edição após quitação gera aviso; exclusão cancela a parte em aberto do outro");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("7 cenários de despesas compartilhadas aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
