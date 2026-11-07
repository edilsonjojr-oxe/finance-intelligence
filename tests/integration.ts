import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  authenticate,
  authStatus,
  logout,
  passwordHash,
  requireUser,
} from "../src/server/auth";
import { database, transaction } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { localToday, addDays } from "../src/lib/money";
import { totals, forecast } from "../src/lib/finance";

async function main() {
  process.env.DATABASE_URL = "";
  const directory = path.resolve(".data", `test-${randomUUID()}`);
  process.env.FINANCE_DATA_DIR = directory;
  const today = localToday(),
    yesterday = addDays(today, -1),
    tomorrow = addDays(today, 1);
  const checks: string[] = [];
  const pass = (name: string) => {
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  assert.equal((await authStatus()).needsSetup, true);
  const token = await authenticate(
    "setup",
    "test@example.invalid",
    "Test-only-password-123!",
    "Teste",
  );
  const session = await authStatus(token);
  assert.ok(session.user);
  const user = session.user.id;
  await assert.rejects(() =>
    authenticate(
      "setup",
      "other@example.invalid",
      "Test-only-password-123!",
      "Outro",
    ),
  );
  await assert.rejects(() =>
    authenticate("login", "test@example.invalid", "incorrect-password"),
  );
  await assert.rejects(() => requireUser("invalid-token"));
  pass("Cadastro único, autenticação e sessão protegida");
  const a = await financeAction(user, "account.create", {
    name: "Conta A",
    institution: "Sintética",
    type: "checking",
    opening_balance: "1000.00",
    opening_date: yesterday,
  });
  const b = await financeAction(user, "account.create", {
    name: "Conta B",
    institution: "Sintética",
    type: "savings",
    opening_balance: "0.00",
    opening_date: yesterday,
  });
  await financeAction(user, "movement.create", {
    account_id: a.id,
    kind: "income",
    amount: "200.10",
    date: today,
    competence: today,
    description: "Receita teste",
    category: "Salário",
  });
  await financeAction(user, "movement.create", {
    account_id: a.id,
    destination_account_id: b.id,
    kind: "transfer",
    amount: "100.00",
    date: today,
    competence: today,
    description: "Transferência",
    category: "Outros",
  });
  let state = await getFinance(user);
  assert.equal(state.accounts[0].balance, "1100.10");
  assert.equal(state.accounts[1].balance, "100.00");
  assert.equal(totals(state.transactions, today.slice(0, 7)).income, "200.10");
  pass("Saldos e transferências sem receita duplicada");
  const obligation = await financeAction(user, "obligation.create", {
    description: "Internet",
    amount: "50.00",
    due_date: tomorrow,
    kind: "expense",
    category: "Internet",
  });
  await financeAction(user, "obligation.settle", {
    id: obligation.id,
    account_id: a.id,
    date: today,
  });
  await assert.rejects(() =>
    financeAction(user, "obligation.settle", {
      id: obligation.id,
      account_id: a.id,
      date: today,
    }),
  );
  state = await getFinance(user);
  assert.equal(state.accounts[0].balance, "1050.10");
  assert.equal(state.obligations[0].status, "paid");
  const payment = state.obligations[0].settled_transaction_id!;
  await financeAction(user, "movement.reverse", {
    id: payment,
    reason: "Teste de reversão auditável",
  });
  state = await getFinance(user);
  assert.equal(state.accounts[0].balance, "1100.10");
  assert.equal(state.obligations[0].status, "open");
  pass("Liquidação única e estorno reabrindo compromisso");
  const existing = await financeAction(user, "movement.create", {
    account_id: a.id,
    kind: "expense",
    amount: "50.00",
    date: today,
    competence: today,
    description: "Pagamento importado",
    category: "Internet",
  });
  const beforeLink = (await getFinance(user)).transactions.length;
  await financeAction(user, "obligation.settle", {
    id: obligation.id,
    existing_transaction_id: existing.id,
  });
  state = await getFinance(user);
  assert.equal(state.transactions.length, beforeLink);
  assert.equal(state.obligations[0].status, "paid");
  pass("Conciliação de obrigação com pagamento existente sem novo gasto");
  await financeAction(user, "contract.create", {
    title: "Aluguel",
    counterparty: "Contrato sintético",
    amount: "100.00",
    start_date: tomorrow,
    months: 3,
    due_day: Number(tomorrow.slice(8)),
    category: "Moradia",
    adjustment_note: "",
  });
  state = await getFinance(user);
  assert.equal(state.contracts.length, 1);
  assert.equal(state.obligations.filter((o) => o.contract_id).length, 3);
  const projected = forecast(state.accounts, state.obligations, today, 90);
  assert.ok(projected.some((p) => p.expense === "100.00"));
  pass("Contrato gera ocorrências e alimenta projeção");
  const csv = `data;descricao;valor\n${today};Compra teste;-10,25`;
  async function stage(content: string) {
    return financeAction(user, "import.stage", {
      account_id: a.id,
      filename: "synthetic.csv",
      format: "csv",
      content,
    });
  }
  let batch = await stage(csv);
  state = await getFinance(user);
  let candidates = state.candidates.filter((c) => c.batch_id === batch.id);
  await financeAction(user, "import.commit", {
    id: batch.id,
    selected: candidates.map((c) => c.id),
  });
  const count = (await getFinance(user)).transactions.length;
  await financeAction(user, "import.commit", {
    id: batch.id,
    selected: candidates.map((c) => c.id),
  });
  assert.equal((await getFinance(user)).transactions.length, count);
  batch = await stage(csv);
  state = await getFinance(user);
  candidates = state.candidates.filter((c) => c.batch_id === batch.id);
  assert.equal(candidates[0].duplicate, "exact");
  await financeAction(user, "import.commit", {
    id: batch.id,
    selected: candidates.map((c) => c.id),
  });
  assert.equal((await getFinance(user)).transactions.length, count);
  pass("Mesmo lote e mesmo arquivo idempotentes");
  batch = await stage(csv + "\n");
  state = await getFinance(user);
  candidates = state.candidates.filter((c) => c.batch_id === batch.id);
  assert.equal(candidates[0].duplicate, "possible");
  await assert.rejects(() =>
    financeAction(user, "import.commit", {
      id: batch.id,
      selected: candidates.map((c) => c.id),
    }),
  );
  assert.equal((await getFinance(user)).transactions.length, count);
  pass("Duplicidade provável exige confirmação explícita");
  batch = await stage(
    `data;descricao;valor\n${today};Válida;-3,00\n${tomorrow};Futura;-4,00`,
  );
  state = await getFinance(user);
  candidates = state.candidates.filter((c) => c.batch_id === batch.id);
  await assert.rejects(() =>
    financeAction(user, "import.commit", {
      id: batch.id,
      selected: candidates.map((c) => c.id),
    }),
  );
  state = await getFinance(user);
  assert.equal(state.transactions.length, count);
  assert.equal(state.batches.find((b) => b.id === batch.id)!.status, "review");
  pass("Erro no lote reverte todas as inserções");
  const other = randomUUID();
  await transaction(null, async (db) => {
    await db.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [
        other,
        "Isolado",
        "isolated@example.invalid",
        await passwordHash("Test-only-password-123!"),
      ],
    );
  });
  assert.equal((await getFinance(other)).accounts.length, 0);
  await assert.rejects(() =>
    financeAction(other, "movement.create", {
      account_id: a.id,
      kind: "expense",
      amount: "1.00",
      date: today,
      competence: today,
      description: "Acesso indevido",
      category: "Outros",
    }),
  );
  await assert.rejects(() =>
    financeAction(other, "movement.reverse", {
      id: existing.id,
      reason: "Acesso indevido",
    }),
  );
  await transaction(user, async (db) => {
    await db.query(
      "CREATE ROLE fi_test_restricted NOLOGIN NOSUPERUSER NOBYPASSRLS",
    );
    await db.query("GRANT SELECT ON accounts TO fi_test_restricted");
    await db.query("SET LOCAL ROLE fi_test_restricted");
    const own = await db.query("SELECT id FROM accounts");
    assert.equal(own.rows.length, 2);
    await db.query("SELECT set_config('app.user_id',$1,true)", [other]);
    const none = await db.query("SELECT id FROM accounts");
    assert.equal(none.rows.length, 0);
  });
  pass("Isolamento por proprietário e RLS com papel restrito");
  await assert.rejects(() =>
    transaction(user, (db) =>
      db.query("DELETE FROM audit_events WHERE user_id=$1", [user]),
    ),
  );
  pass("Auditoria rejeita exclusão de eventos no banco");
  await logout(token);
  await assert.rejects(() => requireUser(token));
  pass("Logout revoga sessão no servidor");
  const db = await database();
  if (db.mode !== "local") throw new Error("Banco de teste inválido.");
  await db.client.close();
  const reopened = new PGlite(directory);
  await reopened.waitReady;
  const persisted = await reopened.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM transactions",
  );
  assert.equal(Number(persisted.rows[0].count), count);
  await reopened.close();
  pass("Persistência confirmada após fechar e reabrir PostgreSQL");
  console.log(
    `\n${checks.length} cenários de integração aprovados. Base sintética: ${directory}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
