// Consultor IA com o modelo simulado (sem rede): consentimento, limite diário, laço de ferramentas,
// cálculos verificáveis (simulação de parcelas) e somente leitura. Somente dados sintéticos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { authenticate, requireUser } from "../src/server/auth";
import { database, transaction } from "../src/server/db";
import { financeAction, getFinance } from "../src/server/finance-service";
import { advisorStatus, advisorTools, askAdvisor, DAILY_QUESTIONS, setAdvisorConsent } from "../src/server/advisor";
import { addDays, localToday } from "../src/lib/money";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
const reply = (content: unknown[], stop: string): Anthropic.Beta.BetaMessage =>
  ({ id: randomUUID(), type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) as unknown as Anthropic.Beta.BetaMessage;

async function main() {
  process.env.DATABASE_URL = "";
  process.env.SETUP_TOKEN = "";
  process.env.ANTHROPIC_API_KEY = "";
  process.env.FINANCE_DATA_DIR = path.resolve(".data", `test-advisor-${randomUUID()}`);
  const pass = (name: string) => console.log(`PASS ${name}`);
  const today = localToday();
  const A = (await requireUser(await authenticate("setup", "a@exemplo.invalid", "Senha-sintetica-123!", "Ana"))).id;
  const acc = (await financeAction(A, "account.create", { name: "Conta A", type: "checking", opening_balance: "1000.00", opening_date: addDays(today, -40) })).id;
  await financeAction(A, "movement.create", { kind: "expense", amount: "120.00", date: today, competence: today, account_id: acc, description: "Mercado QA", category: "Alimentação / Mercado" });
  await financeAction(A, "obligation.create", { description: "Aluguel QA", amount: "500.00", due_date: addDays(today, 10), kind: "expense", category: "Moradia" });

  // 1. Sem consentimento: recusa; sem chave e sem modelo simulado: recusa com mensagem clara.
  await assert.rejects(() => askAdvisor(A, { question: "Quanto gastei?" }, async () => reply([], "end_turn")), /Ative o consultor/);
  await setAdvisorConsent(A, true);
  await assert.rejects(() => askAdvisor(A, { question: "Quanto gastei?" }), /não foi configurado/);
  pass("Exige ativação explícita e chave configurada");

  // 2. Laço de ferramentas: o modelo pede dados, o app calcula e devolve; simulação de parcelas.
  const seen: Params[] = [];
  let step = 0;
  const runner = async (p: Params) => {
    seen.push(structuredClone(p));
    step++;
    if (step === 1)
      return reply([
        { type: "tool_use", id: "t1", name: "resumo_atual", input: {} },
        { type: "tool_use", id: "t2", name: "projetar_saldo", input: { dias: 90, simulacao: [{ descricao: "Celular", valor_total: "1000.01", data: addDays(today, 5), parcelas: 3 }] } },
      ], "tool_use");
    return reply([{ type: "text", text: "Seu menor saldo previsto é **R$ X**." }], "end_turn");
  };
  const before = (await getFinance(A)).transactions.length;
  const r = await askAdvisor(A, { question: "Posso comprar um celular de R$ 1.000 em 3x?" }, runner);
  assert.equal(r.answer, "Seu menor saldo previsto é **R$ X**.");
  assert.deepEqual(r.steps.map((s) => s.tool), ["resumo_atual", "projetar_saldo"]);
  const toolMsg = seen[1].messages.at(-1)!;
  const results = (toolMsg.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((b) => JSON.parse(String(b.content)));
  assert.equal(results[0].saldo_total_contas, "880.00");
  assert.equal(results[0].compromissos_30_dias.a_pagar, "500.00");
  const sim = results[1].lancamentos_simulados.map((x: { valor: string }) => x.valor);
  assert.deepEqual(sim, ["333.35", "333.33", "333.33"], "Parcelas somam exatamente o total");
  assert.equal(results[1].sem_simulacao.menor_saldo, "380.00");
  assert.equal(results[1].com_simulacao.menor_saldo, "-620.01", "380 - 1000,01 (3 parcelas dentro de 90 dias)");
  assert.ok(results[1].com_simulacao.primeiro_dia_negativo);
  assert.equal((await getFinance(A)).transactions.length, before, "Nada gravado");
  assert.equal(seen[0].model, "claude-opus-5-5");
  assert.deepEqual(seen[0].tools!.map((t) => (t as Anthropic.Tool).name), advisorTools.map((t) => t.name));
  pass("Ferramentas calculam no app (saldo, compromissos, parcelas exatas) e nada é gravado");

  // 3. Parâmetro inválido vira erro de ferramenta (não derruba a resposta); recusa vira mensagem.
  let n = 0;
  const bad = await askAdvisor(A, { question: "Gastos de ontem?" }, async (p) => {
    n++;
    if (n === 1) return reply([{ type: "tool_use", id: "x", name: "gastos_por_categoria", input: { mes: "outubro" } }], "tool_use");
    const last = p.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    assert.equal(last[0].is_error, true);
    return reply([{ type: "text", text: "Ok." }], "end_turn");
  });
  assert.equal(bad.answer, "Ok.");
  const refused = await askAdvisor(A, { question: "Teste" }, async () => reply([], "refusal"));
  assert.match(refused.answer, /Não consigo ajudar/);
  pass("Parâmetros inválidos voltam como erro da ferramenta; recusa vira resposta amigável");

  // 4. Limite diário e isolamento: outro usuário não usa a cota nem os dados de A.
  await transaction(A, (db) => db.query("UPDATE ai_usage SET questions=$2 WHERE user_id=$1", [A, DAILY_QUESTIONS]));
  await assert.rejects(() => askAdvisor(A, { question: "Mais uma?" }, runner), /Limite de/);
  assert.equal((await advisorStatus(A)).used, DAILY_QUESTIONS, "Pergunta recusada não conta");
  await setAdvisorConsent(A, false);
  assert.equal((await advisorStatus(A)).enabled, false);
  pass("Limite diário respeitado; desativar remove o consentimento");

  const db = await database();
  if (db.mode === "local") await db.client.close();
  console.log("4 cenários do consultor aprovados; somente dados sintéticos, sem chamadas de rede.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
