// Grupos de divisão (Etapa 2): link de convite, conta "só divisão", membro sem conta,
// encerramento, dívidas simplificadas, grupo sem lançamento e upgrade. Somente dados sintéticos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authenticate, authStatus, createInvite, requireUser } from "../src/server/auth";
import { database, transaction } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { invitePreview } from "../src/server/shared";
import { addDays, localToday } from "../src/lib/money";

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-split-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const pw = "Senha-sintetica-123!", today = localToday();
  const A = (await requireUser(await authenticate("setup", "a@exemplo.invalid", pw, "Ana"))).id;
  const B = (await requireUser(await authenticate("register", "b@exemplo.invalid", pw, "Bruno", (await createInvite(A)).code))).id;
  const accA = (await financeAction(A, "account.create", { name: "Conta A", type: "checking", opening_balance: "5000.00", opening_date: addDays(today, -60) })).id;
  const preview = (t: string) => transaction(null, (db) => invitePreview(db, t));

  // 1. Grupo de viagem com período e pessoa sem conta; link com hash, limite de usos e prévia.
  await assert.rejects(() => financeAction(A, "group.create", { name: "Praia", kind: "trip", starts_on: today, ends_on: addDays(today, -1) }), /fim do período/);
  const praia = (await financeAction(A, "group.create", { name: "Praia", kind: "trip", starts_on: addDays(today, -3), ends_on: today, guest_names: ["Duda"] })).id;
  const grp = async (u: string) => (await getFinance(u)).shared.groups.find((x) => x.id === praia)!;
  let g = await grp(A);
  assert.deepEqual([g.kind, g.starts_on, g.ends_on, g.members.length], ["trip", addDays(today, -3), today, 2]);
  const duda = g.members.find((m) => m.guest)!;
  const link = (await financeAction(A, "invite.create", { group_id: praia, days: 7, max_uses: 2 })) as unknown as { token: string };
  assert.match(link.token, /^[A-Za-z0-9_-]{32}$/);
  await transaction(A, async (db) => {
    const r = await db.query<{ token_hash: string }>("SELECT token_hash FROM share_invites WHERE group_id=$1", [praia]);
    assert.notEqual(r.rows[0].token_hash, link.token, "Só o hash é guardado");
  });
  const p = await preview(link.token);
  assert.deepEqual([p.group_name, p.inviter, p.guests.map((x) => x.name)], ["Praia", "Ana", ["Duda"]]);
  await assert.rejects(() => preview("x".repeat(32)), /inválido/);
  pass("Grupo de viagem com período e pessoa sem conta; link guarda só o hash e mostra prévia só com token válido");

  // 2. Conta "só divisão" criada pelo link, assumindo a pessoa sem conta; servidor bloqueia o resto.
  const D = (await requireUser(await authenticate("split", "d@exemplo.invalid", pw, "Duda Silva", link.token, duda.id))).id;
  assert.equal((await authStatus(await authenticate("login", "d@exemplo.invalid", pw))).user!.plan, "split_only");
  g = await grp(D);
  assert.equal(g.members.find((m) => m.me)!.id, duda.id, "Duda assumiu o membro sem conta");
  assert.equal(g.skip_ledger, true);
  await assert.rejects(() => financeAction(D, "account.create", { name: "X", type: "checking", opening_balance: "0", opening_date: today }), /só para dividir/);
  await assert.rejects(() => financeAction(D, "budget.set", { category: "Lazer", amount: "10.00" }), /só para dividir/);
  await assert.rejects(() => createInvite(D), /contas completas/);
  await assert.rejects(() => authenticate("split", "d@exemplo.invalid", pw, "Outra", link.token), /já tem acesso/);
  pass("Conta só divisão pelo link assume o membro sem conta; servidor recusa ações fora do Dividir e convites do app");

  // 3. Limite de usos e revogação.
  const E = (await requireUser(await authenticate("split", "e@exemplo.invalid", pw, "Edu", link.token))).id;
  await assert.rejects(() => authenticate("split", "f@exemplo.invalid", pw, "Fabi", link.token), /esgotado/);
  assert.equal((await transaction(null, (db) => db.query("SELECT 1 FROM users WHERE email='f@exemplo.invalid'"))).rows.length, 0, "Cadastro desfeito");
  const link2 = (await financeAction(A, "invite.create", { group_id: praia, days: 1, max_uses: 5 })) as unknown as { token: string };
  const inviteId = (await grp(A)).invites[0].id;
  await assert.rejects(() => financeAction(D, "invite.revoke", { id: inviteId }), /Só quem criou/);
  await financeAction(A, "invite.revoke", { id: inviteId });
  await assert.rejects(() => preview(link2.token), /inválido/);
  await assert.rejects(() => financeAction(B, "invite.join", { token: link2.token }), /inválido/);
  pass("Link respeita limite de usos (sem criar conta órfã) e deixa de funcionar ao ser revogado");

  // 4. Despesas: conta completa lança no ledger; só divisão não; saldos e dívidas simplificadas.
  g = await grp(A);
  const [mA, mD] = [g.my_member_id, duda.id];
  const mE = g.members.find((m) => m.name === "Edu")!.id;
  await financeAction(A, "shared.create", { group_id: praia, description: "Pousada", total: "900.00", date: today, payer_member_id: mA, mode: "equal", account_id: accA });
  await financeAction(D, "shared.create", { group_id: praia, description: "Jantar", total: "300.00", date: today, payer_member_id: mD, mode: "equal" });
  const sD = await getFinance(D);
  assert.deepEqual([sD.accounts.length, sD.obligations.length, sD.shared.inbox.length], [0, 0, 0], "Só divisão: nada no ledger");
  g = await grp(A);
  assert.deepEqual([g.balances[mA], g.balances[mD], g.balances[mE]], ["500.00", "-100.00", "-400.00"]);
  assert.deepEqual(g.suggestions, [{ from: mE, to: mA, amount: "400.00" }, { from: mD, to: mA, amount: "100.00" }]);
  pass("Conta completa lança só a própria parte; só divisão não mexe em ledger; saldos e dívidas simplificadas corretos");

  // 5. Acerto confirmado (só divisão informa o valor) e recebimento de pessoa sem conta.
  const s1 = (await financeAction(D, "settle.pay", { group_id: praia, to_member_id: mA, amount: "100.00", date: today })) as { id: string };
  assert.equal((await grp(A)).balances[mD], "-100.00", "Pendente não altera saldo");
  await financeAction(A, "settle.confirm", { id: s1.id, account_id: accA });
  assert.equal((await grp(A)).balances[mD], "0.00");
  const gu = (await financeAction(A, "group.add_guest", { group_id: praia, name: "Gabi" })).id;
  await financeAction(A, "shared.create", { group_id: praia, description: "Gasolina", total: "40.00", date: today, payer_member_id: mA, mode: "selected", selected: [mA, gu] });
  await financeAction(A, "settle.receive", { group_id: praia, from_member_id: gu, amount: "20.00", date: today, account_id: accA });
  await assert.rejects(() => financeAction(A, "settle.receive", { group_id: praia, from_member_id: mE, amount: "1.00", date: today, account_id: accA }), /tem conta/);
  await assert.rejects(() => financeAction(A, "group.remove_guest", { group_id: praia, member_id: gu }), /já tem despesas/);
  const sDcsv = (await grp(A)).feed.map((f) => f.text).join(" | ");
  assert.ok(sDcsv.includes('Duda lançou "Jantar"') && sDcsv.includes("confirmou o recebimento"), "Feed registra ações");
  pass("Acerto só vale após confirmação; recebimento de pessoa sem conta; feed de atividade");

  // 6. Encerrar trava lançamentos e links; reabrir; arquivar só encerrado.
  await assert.rejects(() => financeAction(D, "group.close", { group_id: praia }), /Só quem criou/);
  await assert.rejects(() => financeAction(A, "group.archive", { group_id: praia }), /Encerre/);
  await financeAction(A, "group.close", { group_id: praia });
  await assert.rejects(() => financeAction(D, "shared.create", { group_id: praia, description: "X", total: "10.00", date: today, payer_member_id: mD, mode: "equal" }), /encerrado/);
  await assert.rejects(() => financeAction(A, "invite.create", { group_id: praia }), /encerrado/);
  const exp = (await grp(A)).expenses[0].id;
  await assert.rejects(() => financeAction(A, "shared.delete", { id: exp }), /encerrado/);
  await financeAction(E, "settle.pay", { group_id: praia, to_member_id: mA, amount: "400.00", date: today });
  await financeAction(A, "group.reopen", { group_id: praia });
  await financeAction(A, "group.close", { group_id: praia });
  await financeAction(A, "group.archive", { group_id: praia });
  assert.equal((await grp(A)).status, "archived");
  pass("Encerrar trava novas despesas, edição e links (acertos continuam); reabrir; arquivar só depois de encerrar");

  // 7. Conta completa pode não lançar o grupo; upgrade de só divisão para completa por convite.
  const cn = (await financeAction(A, "connect.request", { email: "b@exemplo.invalid" }), (await getFinance(B)).shared.connections.find((c) => c.incoming)!);
  await financeAction(B, "connect.respond", { id: cn.id, accept: true });
  const casa = (await financeAction(A, "group.create", { name: "Casa", member_user_ids: [B] })).id;
  await financeAction(B, "group.settings", { group_id: casa, auto_post: false, skip_ledger: true });
  const gc = (await getFinance(A)).shared.groups.find((x) => x.id === casa)!;
  await financeAction(A, "shared.create", { group_id: casa, description: "Luz", total: "100.00", date: today, payer_member_id: gc.my_member_id, mode: "equal", account_id: accA });
  const sB = await getFinance(B);
  assert.deepEqual([sB.shared.inbox.length, sB.obligations.length], [0, 0], "Grupo marcado para não lançar");
  await financeAction(B, "group.settings", { group_id: casa, auto_post: false, skip_ledger: false });
  const luz = (await getFinance(B)).shared.inbox[0].expense_id;
  await financeAction(B, "shared.skip", { expense_id: luz });
  assert.equal((await getFinance(B)).shared.inbox.length, 0, "Ignorar uma parte específica");
  const code = (await createInvite(A)).code;
  await assert.rejects(() => authenticate("register", "d@exemplo.invalid", "Senha-errada-12345", "Duda", code), /já tem acesso/);
  await authenticate("register", "d@exemplo.invalid", pw, "Duda", (await createInvite(A)).code);
  assert.ok((await financeAction(D, "account.create", { name: "Conta D", type: "checking", opening_balance: "0", opening_date: today })).id);
  pass("Conta completa pode não lançar um grupo ou ignorar uma parte; convite completo transforma só divisão em conta completa");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("7 cenários de grupos de divisão aprovados; somente dados sintéticos.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
