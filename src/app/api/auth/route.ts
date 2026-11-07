import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, authStatus, createInvite, logout, requireUser, sessionCookie } from "@/server/auth";
import { errorResponse, readBody } from "@/server/http";
import { secureCookies } from "@/server/deployment-config";
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
    if (body.action === "invite") {
      const user = await requireUser(request.cookies.get(sessionCookie)?.value);
      return NextResponse.json(await createInvite(user.id));
    }
    const v = z
      .object({
        action: z.enum(["login", "setup", "register"]),
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(12).max(128),
        name: z.string().trim().max(100).optional(),
        setup_token: z.string().max(200).optional(),
        invite_code: z.string().max(40).optional(),
      })
      .parse(body);
    if (v.action !== "login" && !v.name)
      return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });
    if (v.action === "register" && !v.invite_code)
      return NextResponse.json({ error: "Informe o código de convite." }, { status: 400 });
    const token = await authenticate(
      v.action,
      v.email,
      v.password,
      v.name,
      v.action === "register" ? v.invite_code : v.setup_token,
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie, token, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "strict",
      path: "/",
      maxAge: 43200,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
