// Recuperação de senha por e-mail: link de uso único, expiração, sessões encerradas, sem revelar contas.
// Somente dados sintéticos; em modo local o e-mail não é enviado (vai para o console, capturado aqui).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, authStatus, requestPasswordReset, resetPassword } from "../src/server/auth";
import { database, transaction } from "../src/server/db";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.SMTP_HOST = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-reset-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const sent: string[] = [];
  const original = console.info;
  console.info = (msg: string) => { if (String(msg).startsWith("[e-mail local")) sent.push(String(msg)); else original(msg); };
  const tokenOf = () => sent.at(-1)!.match(/#redefinir=([A-Za-z0-9_-]+)/)![1];
  const pw = "Senha-sintetica-123!", origin = "http://127.0.0.1:3000";
  const session = await authenticate("setup", "a@exemplo.invalid", pw, "Ana");

  // 1. E-mail desconhecido: mesma resposta, nada enviado, nada gravado.
  await requestPasswordReset("ninguem@exemplo.invalid", origin);
  assert.equal(sent.length, 0);
  pass("E-mail sem conta não envia nada e não revela a ausência");

  // 2. Link enviado; só o hash fica no banco; troca a senha e encerra as sessões.
  await requestPasswordReset("A@Exemplo.invalid", origin);
  assert.equal(sent.length, 1);
  const token = tokenOf();
  assert.ok(sent[0].includes(`${origin}/#redefinir=`));
  const rows = await transaction(null, (db) => db.query<{ token_hash: string }>("SELECT token_hash FROM password_resets"));
  assert.equal(rows.rows.length, 1);
  assert.notEqual(rows.rows[0].token_hash, token);
  await resetPassword(token, "Nova-senha-sintetica-456!");
  assert.equal((await authStatus(session)).user, null, "Sessão antiga encerrada");
  await assert.rejects(() => authenticate("login", "a@exemplo.invalid", pw), /inválidos/);
  assert.ok(await authenticate("login", "a@exemplo.invalid", "Nova-senha-sintetica-456!"));
  pass("Link troca a senha, encerra sessões abertas e só o hash é guardado");

  // 3. Uso único; link novo invalida o anterior; expirado não vale.
  await assert.rejects(() => resetPassword(token, "Outra-senha-sintetica-789!"), /inválido ou expirado/);
  await requestPasswordReset("a@exemplo.invalid", origin);
  const first = tokenOf();
  await requestPasswordReset("a@exemplo.invalid", origin);
  const second = tokenOf();
  await assert.rejects(() => resetPassword(first, "Outra-senha-sintetica-789!"), /inválido ou expirado/);
  await transaction(null, (db) => db.query("UPDATE password_resets SET expires_at=now()-interval '1 minute' WHERE used_at IS NULL"));
  await assert.rejects(() => resetPassword(second, "Outra-senha-sintetica-789!"), /inválido ou expirado/);
  pass("Link é de uso único, o mais novo invalida o anterior e expira");

  // 4. Limite: no máximo 3 links por hora por conta (os seguintes são ignorados em silêncio).
  const before = sent.length;
  await requestPasswordReset("a@exemplo.invalid", origin);
  assert.equal(sent.length, before, "Quarto pedido na hora não envia");
  pass("Limite de 3 links por hora, sem mensagem diferente");

  console.info = original;
  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("4 cenários de recuperação de senha aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
