// Empréstimos/acordos e importação de planilha: parcelas, histórico pago, direção e idempotência.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, requireUser } from "../src/server/auth";
import { database } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { addDays, localToday } from "../src/lib/money";
import { splitTotal } from "../src/server/loans";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-loans-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const today = localToday();
  const user = (await requireUser(await authenticate("setup", "emprestimo@exemplo.invalid", "Senha-sintetica-123!", "Pessoa"))).id;
  const conta = await financeAction(user, "account.create", { name: "Conta", type: "checking", opening_balance: "1000.00", opening_date: addDays(today, -400) });

  assert.deepEqual(splitTotal("1000.00", 3), ["333.33", "333.33", "333.34"]);
  const lau = await financeAction(user, "loan.create", { direction: "payable", counterparty: "Amiga Sintética", mode: "total", total_amount: "1000.00", installments: "3", first_due_date: addDays(today, 5), paid_count: "1" });
  let state = await getFinance(user);
  const c = state.contracts.find((x) => x.id === lau.id)!;
  assert.equal(c.direction, "payable");
  assert.equal(c.title, "Empréstimo com Amiga Sintética");
  const parcels = state.obligations.filter((o) => o.contract_id === lau.id);
  assert.deepEqual(parcels.map((o) => [o.amount, o.status, o.kind]), [["333.33", "paid", "expense"], ["333.33", "open", "expense"], ["333.34", "open", "expense"]]);
  assert.equal(state.accounts[0].balance, "1000.00", "Parcela marcada como já paga não altera saldo");
  pass("Empréstimo 'eu devo' por valor total: divide em parcelas, primeira já paga como histórico");

  const emprestei = await financeAction(user, "loan.create", { direction: "receivable", counterparty: "Primo", mode: "installment", installment_amount: "200.00", installments: "4", first_due_date: addDays(today, 10) });
  state = await getFinance(user);
  assert.ok(state.obligations.filter((o) => o.contract_id === emprestei.id).every((o) => o.kind === "income" && o.amount === "200.00"));
  assert.equal(state.contracts.find((x) => x.id === emprestei.id)!.direction, "receivable");
  pass("Empréstimo 'me devem' por valor da parcela gera parcelas a receber");

  const open = state.obligations.find((o) => o.contract_id === lau.id && o.status === "open")!;
  await financeAction(user, "obligation.settle", { id: open.id, account_id: conta.id, date: today });
  state = await getFinance(user);
  assert.equal(state.accounts[0].balance, "666.67");
  const histo = state.obligations.find((o) => o.contract_id === lau.id && o.status === "open")!;
  await financeAction(user, "obligation.mark_paid", { id: histo.id });
  await financeAction(user, "obligation.reopen", { id: histo.id });
  await assert.rejects(() => financeAction(user, "obligation.reopen", { id: open.id }), /estorne/);
  pass("Parcela paga pela conta baixa o saldo; 'já paga' e reabrir funcionam sem mexer no saldo");

  const print = await financeAction(user, "loan.create", { direction: "payable", counterparty: "Loja", contract_type: "agreement", mode: "schedule", schedule: [{ date: addDays(today, 1), amount: "50.00" }, { date: addDays(today, 31), amount: "75.50" }] });
  assert.equal((await getFinance(user)).obligations.filter((o) => o.contract_id === print.id).length, 2);
  await assert.rejects(() => financeAction(user, "loan.create", { direction: "payable", counterparty: "X", mode: "total", installments: "2", first_due_date: today }), /valor total/);
  pass("Acordo com parcelas informadas uma a uma (ex.: lidas de um print); validação de campos");

  const sheet = {
    source_hash: "c".repeat(64), paid_mode: "account", account_id: conta.id,
    monthly: [
      { description: "Netflix", amount: "22.45", date: addDays(today, -30), paid: true, category: "Assinaturas / Streaming" },
      { description: "Aluguel", amount: "592.50", date: addDays(today, -500), paid: true, category: "Moradia / Aluguel e condomínio" },
      { description: "Condomínio", amount: "150.19", date: addDays(today, 3), paid: false, category: "Moradia/Aluguel e condomínio" },
    ],
    schedules: [{ title: "EMPRESTIMO 2", direction: "payable", category: "", installments: [
      { date: addDays(today, -60), amount: "178.85", paid: true }, { date: addDays(today, -30), amount: "178.85", paid: true }, { date: addDays(today, 0), amount: "178.85", paid: false },
    ] }],
    recurring: [{ description: "CANVA PRO", amount: "35.00", due_day: "10", months: "12", category: "Assinaturas / Software e apps" }],
  };
  const r = await financeAction(user, "sheet.import", sheet) as unknown as Record<string, number>;
  assert.deepEqual([r.monthly, r.payments, r.history, r.schedules, r.recurring, r.skipped], [3, 1, 1, 1, 1, 0]);
  state = await getFinance(user);
  assert.equal(state.accounts[0].balance, "644.22", "Só o pago dentro da cobertura da conta virou movimento");
  assert.equal(state.obligations.find((o) => o.description === "Condomínio")!.category, "Moradia / Aluguel e condomínio");
  const emp = state.contracts.find((x) => x.title === "EMPRESTIMO 2")!;
  assert.equal(emp.category, "Dívidas e empréstimos / Parcelas de empréstimo");
  assert.equal(state.obligations.filter((o) => o.contract_id === emp.id && o.status === "paid").length, 2);
  assert.equal(state.obligations.filter((o) => o.description === "CANVA PRO").length, 12);
  pass("Planilha: contas mensais (pago na conta, pago histórico, pendente), empréstimo com pagas e assinatura recorrente");

  const again = await financeAction(user, "sheet.import", sheet) as unknown as Record<string, number>;
  assert.deepEqual([again.monthly, again.schedules, again.recurring, again.skipped], [0, 0, 0, 5]);
  assert.equal((await getFinance(user)).accounts[0].balance, "644.22");
  pass("Reimportar a mesma planilha não duplica nada");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("6 cenários de empréstimos e planilha aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
