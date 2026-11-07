// Multiusuário por convite: isolamento de dados, uso único, expiração e duplicidade.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, authStatus, createInvite, requireUser } from "../src/server/auth";
import { database, transaction } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { localToday } from "../src/lib/money";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-multiuser-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const password = "Senha-sintetica-123!";

  const tokenA = await authenticate("setup", "a@exemplo.invalid", password, "Pessoa A");
  const a = await requireUser(tokenA);
  await financeAction(a.id, "account.create", { name: "Conta de A", institution: "Banco A", type: "checking", opening_balance: "100.00", opening_date: localToday() });
  await assert.rejects(() => authenticate("setup", "x@exemplo.invalid", password, "X"), /primeiro perfil/);
  pass("Primeiro perfil criado; novo setup recusado depois disso");

  await assert.rejects(() => authenticate("register", "b@exemplo.invalid", password, "Pessoa B", "AAAA-BBBB-CCCC"), /Convite inválido/);
  const invite = await createInvite(a.id);
  assert.match(invite.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const tokenB = await authenticate("register", "B@Exemplo.invalid", password, "Pessoa B", invite.code.toLowerCase().replace(/-/g, " "));
  const b = await requireUser(tokenB);
  assert.notEqual(a.id, b.id);
  pass("Convite válido cria usuário (código sem diferenciar maiúsculas/separadores)");

  await assert.rejects(() => authenticate("register", "c@exemplo.invalid", password, "Pessoa C", invite.code), /Convite inválido/);
  pass("Convite é de uso único");

  const second = await createInvite(a.id);
  await assert.rejects(() => authenticate("register", "a@exemplo.invalid", password, "Duplicado", second.code), /já tem acesso/);
  const stillValid = await transaction(null, (db) => db.query<{ n: number }>("SELECT count(*)::int AS n FROM invites WHERE used_by IS NULL"));
  assert.equal(stillValid.rows[0].n, 1, "Convite não é consumido quando o cadastro falha");
  pass("E-mail já cadastrado é recusado sem gastar o convite");

  const expired = await createInvite(a.id);
  await transaction(null, (db) => db.query("UPDATE invites SET expires_at=now()-interval '1 minute' WHERE used_by IS NULL AND created_at=(SELECT max(created_at) FROM invites)"));
  await assert.rejects(() => authenticate("register", "d@exemplo.invalid", password, "Pessoa D", expired.code), /Convite inválido/);
  pass("Convite expirado é recusado");

  const stateB = await getFinance(b.id);
  assert.equal(stateB.accounts.length, 0, "B não vê contas de A");
  await financeAction(b.id, "account.create", { name: "Conta de B", institution: "Banco B", type: "savings", opening_balance: "50.00", opening_date: localToday() });
  const stateA = await getFinance(a.id);
  assert.deepEqual(stateA.accounts.map((x) => x.name), ["Conta de A"]);
  assert.deepEqual((await getFinance(b.id)).accounts.map((x) => x.name), ["Conta de B"]);
  pass("Dados isolados entre usuários");

  assert.equal((await authStatus(tokenB)).user?.email, "b@exemplo.invalid");
  await assert.rejects(() => authenticate("login", "b@exemplo.invalid", "senha-errada-123"), /inválidos/);
  pass("Login de B funciona e senha errada é recusada");

  for (let i = 0; i < 10; i++) await authenticate("login", "a@exemplo.invalid", "errada-" + i + "-xxxxxx").catch(() => {});
  await assert.rejects(() => authenticate("login", "a@exemplo.invalid", password), /Muitas tentativas/);
  await authenticate("login", "b@exemplo.invalid", password);
  pass("Bloqueio por tentativas é por e-mail: B continua entrando enquanto A está bloqueado");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("8 cenários de multiusuário aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
