import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./auth";
import { isAllowedRequestOrigin, platformOrigin } from "./request-origin";
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  // Somente tipo, código e mensagem técnica (infraestrutura/SQL); nunca corpo, parâmetros
  // ou o campo "detail" do PostgreSQL, que pode conter valores.
  const code = (error as { code?: unknown })?.code;
  console.error(
    "Finance request failed:",
    error instanceof Error ? error.name : "Unknown error",
    typeof code === "string" ? code : "",
    error instanceof Error ? error.message.slice(0, 200) : "",
  );
  return NextResponse.json(
    {
      error:
        "Não foi possível concluir a operação. Nenhuma alteração parcial foi salva.",
    },
    { status: 500 },
  );
}
export async function readBody(request: NextRequest) {
  const origin = request.headers.get("origin");
  const platform = platformOrigin();
  if (
    !isAllowedRequestOrigin(origin, request.url, process.env.APP_ORIGIN) &&
    !(platform && origin === platform)
  ) {
    // Origens e configuração não são segredos; ajudam a diagnosticar APP_ORIGIN incorreta.
    console.warn(
      "Origem recusada:",
      (origin || "(ausente)").slice(0, 120),
      "APP_ORIGIN:",
      (process.env.APP_ORIGIN || "(não definida)").slice(0, 120),
    );
    throw new AppError("Origem da solicitação não autorizada.", 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("Envie JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Corpo vazio.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2_100_000) {
      await reader.cancel();
      throw new AppError("Arquivo muito grande.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("JSON inválido.");
  }
}
