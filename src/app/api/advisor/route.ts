import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@google/genai";
import { z } from "zod";
import { AppError, requireUser, sessionCookie } from "@/server/auth";
import { advisorStatus, askAdvisor, setAdvisorConsent } from "@/server/advisor";
import { errorResponse, readBody } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uma pergunta pode precisar de várias consultas ao modelo (ferramentas).
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request.cookies.get(sessionCookie)?.value);
    return NextResponse.json(await advisorStatus(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request.cookies.get(sessionCookie)?.value);
    const body = z.object({ action: z.enum(["enable", "disable", "ask"]), payload: z.unknown().optional() }).parse(await readBody(request));
    if (body.action !== "ask") {
      await setAdvisorConsent(user.id, body.action === "enable");
      return NextResponse.json(await advisorStatus(user.id));
    }
    try {
      return NextResponse.json(await askAdvisor(user.id, body.payload));
    } catch (error) {
      // Erros do provedor: mensagem clara, sem detalhes internos.
      if (error instanceof ApiError) {
        if (error.status === 429) throw new AppError("Limite gratuito do Gemini atingido por agora. Tente de novo em alguns minutos (ou amanhã).", 429);
        if (error.status === 401 || error.status === 403) throw new AppError("A chave do Gemini no servidor é inválida ou sem permissão.", 503);
        console.error("Consultor IA:", error.status, error.message.slice(0, 300));
        throw new AppError("O serviço de IA recusou a pergunta agora. Tente de novo.", 502);
      }
      if (error instanceof TypeError && /fetch/i.test(error.message)) throw new AppError("Não foi possível falar com o serviço de IA. Tente de novo.", 502);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
