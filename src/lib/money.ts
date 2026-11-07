/** Valores decimais na API, centavos BigInt nos cálculos. Nunca soma em ponto flutuante. */
export function cents(value: string): bigint {
  if (!/^-?\d{1,11}(\.\d{1,2})?$/.test(value))
    throw new Error("Valor monetário inválido. Use até duas casas decimais.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
export function brl(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}
export function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1900 &&
    Number(value.slice(0, 4)) <= 2200 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function recurrenceDates(
  start: string,
  months: number,
  day: number,
): string[] {
  const [year, month] = start.split("-").map(Number);
  const dates: string[] = [];
  let offset = 0;
  while (dates.length < months) {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12),
    ).getUTCDate();
    first.setUTCDate(Math.min(day, lastDay));
    const date = first.toISOString().slice(0, 10);
    if (date >= start) dates.push(date);
    offset++;
  }
  return dates;
}
export function installments(total: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 600)
    throw new Error("Parcelamento inválido.");
  const value = cents(total);
  if (value <= 0n) throw new Error("Valor inválido.");
  const base = value / BigInt(count),
    remainder = value % BigInt(count);
  return Array.from({ length: count }, (_, i) =>
    decimal(base + (BigInt(i) < remainder ? 1n : 0n)),
  );
}
