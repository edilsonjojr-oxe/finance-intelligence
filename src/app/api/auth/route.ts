import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, authenticate, authStatus, createInvite, logout, logoutEverywhere, requestPasswordReset, requireUser, resetPassword, resetToken, sessionCookie, SESSION_MAX_DAYS } from "@/server/auth";
import { isHostedDeployment } from "@/server/deployment-config";
import { mailConfigured } from "@/server/mail";
import { errorResponse, readBody } from "@/server/http";
import { secureCookies } from "@/server/deployment-config";
import { transaction } from "@/server/db";
import { invitePreview, inviteToken } from "@/server/shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await authStatus(request.cookies.get(sessionCookie)?.value),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request);
    if (body.action === "logout") {
      await logout(request.cookies.get(sessionCookie)?.value || "");
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(sessionCookie);
      return response;
    }
    if (body.action === "logout_all") {
      const user = await requireUser(request.cookies.get(sessionCookie)?.value);
      const ended = await logoutEverywhere(user.id);
      const response = NextResponse.json({ ok: true, ended });
      response.cookies.delete(sessionCookie);
      return response;
    }
    if (body.action === "invite") {
      const user = await requireUser(request.cookies.get(sessionCookie)?.value);
      return NextResponse.json(await createInvite(user.id));
    }
    if (body.action === "reset_request") {
      const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(body);
      // Hospedado: o link usa só APP_ORIGIN (nunca o Host enviado pelo visitante).
      const origin = isHostedDeployment() ? process.env.APP_ORIGIN || "" : new URL(request.url).origin;
      if (isHostedDeployment() && (!mailConfigured() || !origin))
        throw new AppError("A recuperação por e-mail ainda não foi configurada. Peça ajuda a quem administra o app.", 503);
      try {
        await requestPasswordReset(email, origin);
      } catch (error) {
        if (error instanceof AppError) throw error;
        console.error("Falha ao enviar e-mail de redefinição:", (error as Error).message);
        throw new AppError("Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.", 502);
      }
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reset_confirm") {
      const v = z.object({ token: z.string().regex(resetToken), password: z.string().min(12).max(128) }).parse(body);
      await resetPassword(v.token, v.password);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "group_preview") {
      // Prévia do link de grupo (sem sessão): só com token válido; o token não vai na URL do servidor.
      const { token } = z.object({ token: inviteToken }).parse(body);
      return NextResponse.json(await transaction(null, (db) => invitePreview(db, token)));
    }
    const v = z
      .object({
        action: z.enum(["login", "setup", "register", "split"]),
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(12).max(128),
        name: z.string().trim().max(100).optional(),
        setup_token: z.string().max(200).optional(),
        invite_code: z.string().max(40).optional(),
        group_token: inviteToken.optional(),
        claim_member_id: z.string().uuid().optional(),
      })
      .parse(body);
    if (v.action !== "login" && !v.name)
      return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });
    if (v.action === "register" && !v.invite_code)
      return NextResponse.json({ error: "Informe o código de convite." }, { status: 400 });
    if (v.action === "split" && !v.group_token)
      return NextResponse.json({ error: "Abra o link de convite do grupo." }, { status: 400 });
    const token = await authenticate(
      v.action,
      v.email,
      v.password,
      v.name,
      v.action === "register" ? v.invite_code : v.action === "split" ? v.group_token : v.setup_token,
      v.claim_member_id,
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie, token, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "strict",
      path: "/",
      // O servidor controla a validade (7 dias sem uso, 30 no total); o cookie dura o máximo.
      maxAge: SESSION_MAX_DAYS * 86400,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
