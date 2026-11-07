import assert from "node:assert/strict";
import { localToday } from "../src/lib/money";
async function main() {
  const origin = process.env.FINANCE_TEST_URL;
  if (origin !== "http://127.0.0.1:3001")
    throw new Error(
      "Execute somente no servidor de teste isolado, na porta 3001.",
    );
  let cookie = "";
  const call = async (path: string, body?: unknown, requestOrigin = origin) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        Cookie: cookie,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await call("/api/finance")).status, 401);
  assert.equal(
    (
      await call(
        "/api/auth",
        {
          action: "login",
          email: "qa@example.invalid",
          password: "Finance-QA-only-2026!",
        },
        "https://untrusted.invalid",
      )
    ).status,
    403,
  );
  const status = await (await call("/api/auth")).json();
  const auth = await call("/api/auth", {
    action: status.needsSetup ? "setup" : "login",
    email: "qa@example.invalid",
    password: "Finance-QA-only-2026!",
    name: "Validação",
  });
  assert.equal(auth.status, 200);
  const setCookie = auth.headers.get("set-cookie")!;
  assert.ok(setCookie.includes("HttpOnly"));
  assert.ok(/SameSite=strict/i.test(setCookie));
  cookie = setCookie.split(";")[0];
  const initial = await (await call("/api/finance")).json();
  if (initial.accounts.length === 0) {
    const account = await (
      await call("/api/finance", {
        action: "account.create",
        payload: {
          name: "Conta de validação",
          institution: "Dados sintéticos de teste",
          type: "checking",
          opening_balance: "2500.00",
          opening_date: localToday(),
        },
      })
    ).json();
    assert.ok(account.id);
    const movement = await call("/api/finance", {
      action: "movement.create",
      payload: {
        account_id: account.id,
        kind: "expense",
        amount: "100.10",
        date: localToday(),
        competence: localToday(),
        description: "=SUM(1+1)",
        category: "Outros",
      },
    });
    assert.equal(movement.status, 200);
  }
  const report = await call(`/api/export?month=${localToday().slice(0, 7)}`);
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type")!, /text\/csv/);
  const csv = await report.text();
  assert.ok(csv.includes("'=SUM(1+1)"));
  assert.equal(
    (await call("/api/finance", { action: "unknown", payload: {} })).status,
    404,
  );
  await call("/api/auth", { action: "logout" });
  assert.equal((await call("/api/finance")).status, 401);
  console.log(
    "PASS HTTP: autenticação, cookie HttpOnly/SameSite, CSRF, gravação, exportação CSV com neutralização de fórmula e logout.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
