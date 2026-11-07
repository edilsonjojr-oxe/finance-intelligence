import { describe, it, expect } from "vitest";
import {
  cents,
  decimal,
  installments,
  recurrenceDates,
  validDate,
} from "../src/lib/money";
import { balanceFor, forecast, totals } from "../src/lib/finance";
import { parseImport } from "../src/server/imports";
import type { Account, Movement, Obligation } from "../src/lib/types";
const account: Account = {
  id: "a",
  name: "A",
  institution: "",
  type: "checking",
  opening_balance: "100.00",
  opening_date: "2026-01-01",
  balance: "100.00",
};
const movement: Movement = {
  id: "t",
  account_id: "a",
  destination_account_id: null,
  kind: "expense",
  amount: "30.00",
  date: "2026-01-02",
  competence: "2026-01-02",
  description: "Compra",
  category: "Outros",
  status: "posted",
  source: "manual",
};
const obligation: Obligation = {
  id: "o",
  contract_id: null,
  description: "Conta",
  amount: "40.00",
  due_date: "2026-01-05",
  kind: "expense",
  category: "Outros",
  status: "open",
  settled_transaction_id: null,
};
describe("Regras financeiras", () => {
  it("soma centavos sem erro binário", () =>
    expect(decimal(cents("0.10") + cents("0.20"))).toBe("0.30"));
  it("rejeita precisão excessiva, expoentes e NaN", () => {
    for (const value of ["1.001", "NaN", "1e4", "1,00"])
      expect(() => cents(value)).toThrow();
  });
  it("mantém centavos do total em parcelamento", () => {
    const values = installments("100.00", 3);
    expect(values).toEqual(["33.34", "33.33", "33.33"]);
    expect(values.reduce((n, v) => n + cents(v), 0n)).toBe(10000n);
  });
  it("respeita fim de mês e ano bissexto", () =>
    expect(recurrenceDates("2024-01-31", 3, 31)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
    ]));
  it("não cria ocorrência anterior ao início", () =>
    expect(recurrenceDates("2026-01-20", 2, 10)).toEqual([
      "2026-02-10",
      "2026-03-10",
    ]));
  it("rejeita datas inexistentes", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2024-02-29")).toBe(true);
  });
  it("transferência mantém total e não gera receita ou despesa", () => {
    const transfer = {
      ...movement,
      kind: "transfer" as const,
      destination_account_id: "b",
    };
    const a = balanceFor(account, [transfer], "2026-01-03");
    const b = balanceFor({ ...account, id: "b" }, [transfer], "2026-01-03");
    expect(decimal(cents(a) + cents(b))).toBe("200.00");
    expect(totals([transfer], "2026-01")).toEqual({
      income: "0.00",
      expense: "0.00",
      net: "0.00",
      savingsRate: null,
    });
  });
  it("estornos e movimentos fora da cobertura não alteram saldo", () =>
    expect(
      balanceFor(
        account,
        [
          { ...movement, status: "reversed" },
          { ...movement, date: "2025-12-31" },
        ],
        "2026-01-03",
      ),
    ).toBe("100.00"));
  it("baixa deixa de compor futuro e vencidos entram hoje", () => {
    const points = forecast(
      [account],
      [
        obligation,
        { ...obligation, id: "paid", status: "paid" },
        { ...obligation, id: "late", amount: "20.00", due_date: "2026-01-01" },
      ],
      "2026-01-03",
      4,
    );
    expect(points.map((p) => p.balance)).toEqual([
      "80.00",
      "80.00",
      "40.00",
      "40.00",
    ]);
  });
});
describe("Importação estruturada", () => {
  it("lê CSV brasileiro e preserva sinal, aspas e centavos", () => {
    const rows = parseImport(
      'data;descricao;valor;categoria\n02/01/2026;"Mercado; bairro";-1.234,56;Alimentação',
      "csv",
    );
    expect(rows[0]).toMatchObject({
      date: "2026-01-02",
      description: "Mercado; bairro",
      amount: "1234.56",
      kind: "expense",
    });
  });
  it("mantém fingerprint do mesmo arquivo e identifica linhas iguais distintas", () => {
    const csv =
      "data;descricao;valor\n2026-01-02;Compra;-10\n2026-01-02;Compra;-10";
    const a = parseImport(csv, "csv"),
      b = parseImport(csv, "csv");
    expect(a[0].fingerprint).toBe(b[0].fingerprint);
    expect(a[0].fingerprint).not.toBe(a[1].fingerprint);
  });
  it("lê OFX SGML e usa identificador bancário", () => {
    const ofx =
      "<OFX><STMTTRN><DTPOSTED>20260102120000[-3:BRT]\n<TRNAMT>-12.34\n<FITID>bank123\n<MEMO>Compra\n</STMTTRN></OFX>";
    expect(parseImport(ofx, "ofx")[0]).toMatchObject({
      date: "2026-01-02",
      amount: "12.34",
      bankId: "bank123",
      kind: "expense",
    });
  });
  it("não aceita OFX com entidades externas ou arquivo sem registros", () => {
    expect(() => parseImport("<!DOCTYPE x>", "ofx")).toThrow();
    expect(() => parseImport("data;descricao;valor", "csv")).toThrow();
  });
});
