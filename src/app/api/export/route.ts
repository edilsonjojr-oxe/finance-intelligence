import { NextRequest } from "next/server";
import { requireUser, sessionCookie } from "@/server/auth";
import { getFinance } from "@/server/finance-service";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function cell(value: string) {
  const safe = /^[=+@\t\r-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request.cookies.get(sessionCookie)?.value);
    const state = await getFinance(user.id);
    const month = request.nextUrl.searchParams.get("month") || "";
    const account = request.nextUrl.searchParams.get("account") || "";
    const search = (
      request.nextUrl.searchParams.get("search") || ""
    ).toLowerCase();
    const rows = state.transactions.filter(
      (t) =>
        (!month || t.date.startsWith(month)) &&
        (!account ||
          t.account_id === account ||
          t.destination_account_id === account) &&
        (!search ||
          `${t.description} ${t.category}`.toLowerCase().includes(search)),
    );
    const header = [
      "data",
      "competencia",
      "descricao",
      "tipo",
      "valor_brl",
      "categoria",
      "conta",
      "conta_destino",
      "situacao",
      "origem",
      "gerado_em",
      "filtro_mes",
      "filtro_conta",
      "filtro_busca",
    ];
    const csv = [
      header.map(cell).join(";"),
      ...rows.map((t) =>
        [
          t.date,
          t.competence,
          t.description,
          t.kind,
          t.amount.replace(".", ","),
          t.category,
          state.accounts.find((a) => a.id === t.account_id)?.name || "",
          state.accounts.find((a) => a.id === t.destination_account_id)?.name ||
            "",
          t.status,
          t.source,
          new Date().toISOString(),
          month,
          account,
          search,
        ]
          .map(cell)
          .join(";"),
      ),
    ].join("\r\n");
    return new Response("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="finance-intelligence.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
