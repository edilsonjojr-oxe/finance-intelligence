import { parse } from "csv-parse/sync";
import { hash, AppError } from "./auth";
import { cents, decimal, validDate } from "../lib/money";
export type ParsedRow = {
  date: string;
  description: string;
  amount: string;
  kind: "income" | "expense";
  category: string;
  bankId: string | null;
  fingerprint: string;
};
function parseDate(raw: string) {
  const value = raw.trim();
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(value)
    ? value.split("/").reverse().join("-")
    : value;
  if (!validDate(date))
    throw new AppError(`Data inválida: ${value.slice(0, 30)}.`);
  return date;
}
function row(
  date: string,
  description: string,
  rawAmount: string,
  category: string,
  bankId: string | null,
  source: string,
  index: number,
): ParsedRow {
  const amount = rawAmount
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  const normalized = amount.includes(",")
    ? amount.replace(/\./g, "").replace(",", ".")
    : amount;
  let value: bigint;
  try {
    value = cents(normalized);
  } catch {
    throw new AppError(`Valor inválido na linha ${index + 2}.`);
  }
  if (value === 0n) throw new AppError(`Valor zero na linha ${index + 2}.`);
  if (!description.trim() || description.length > 300)
    throw new AppError(`Descrição inválida na linha ${index + 2}.`);
  return {
    date: parseDate(date),
    description: description.trim(),
    amount: decimal(value < 0n ? -value : value),
    kind: value < 0n ? "expense" : "income",
    category: category.trim().slice(0, 80) || "Sem categoria",
    bankId,
    fingerprint: hash(
      bankId ? `bank:${bankId}` : `file:${source}:row:${index}`,
    ),
  };
}
export function parseImport(
  content: string,
  format: "csv" | "ofx",
): ParsedRow[] {
  if (Buffer.byteLength(content, "utf8") > 2_000_000)
    throw new AppError("Limite de arquivo: 2 MB.");
  const source = hash(content);
  let rows: ParsedRow[];
  if (format === "csv") {
    const first = content.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    const delimiter = first.includes(";") ? ";" : ",";
    let records: Record<string, string>[];
    try {
      records = parse(content, {
        columns: (headers: string[]) =>
          headers.map((h) =>
            h
              .trim()
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, ""),
          ),
        delimiter,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 10_000,
      });
    } catch {
      throw new AppError(
        "CSV inválido. Use as colunas data, descricao, valor e categoria.",
      );
    }
    rows = records.map((r, i) => {
      if (!r.data || !r.descricao || !r.valor)
        throw new AppError(
          "Colunas obrigatórias: data, descricao, valor. Categoria e id são opcionais.",
        );
      return row(
        r.data,
        r.descricao,
        r.valor,
        r.categoria || "",
        r.id || null,
        source,
        i,
      );
    });
  } else {
    if (/<!DOCTYPE|<!ENTITY/i.test(content))
      throw new AppError("OFX com declarações externas não é aceito.");
    const entries = [...content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
    rows = entries.map((match, i) => {
      const tag = (name: string) =>
        new RegExp(`<${name}>([^<\r\n]+)`, "i").exec(match[1])?.[1].trim() ||
        "";
      const rawDate = tag("DTPOSTED").slice(0, 8);
      if (!/^\d{8}$/.test(rawDate))
        throw new AppError("OFX sem data de lançamento válida.");
      return row(
        `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
        tag("MEMO") || tag("NAME"),
        tag("TRNAMT"),
        "Sem categoria",
        tag("FITID") || null,
        source,
        i,
      );
    });
  }
  if (rows.length === 0 || rows.length > 2000)
    throw new AppError("Importe entre 1 e 2.000 movimentos por arquivo.");
  return rows;
}
