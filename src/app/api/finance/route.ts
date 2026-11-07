import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, sessionCookie } from "@/server/auth";
import { financeAction, getFinance } from "@/server/finance-service";
import { errorResponse, readBody } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request.cookies.get(sessionCookie)?.value);
    return NextResponse.json(await getFinance(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request.cookies.get(sessionCookie)?.value);
    const body = z
      .object({ action: z.string().max(50), payload: z.unknown() })
      .parse(await readBody(request));
    return NextResponse.json(
      await financeAction(user.id, body.action, body.payload),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
