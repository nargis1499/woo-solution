import { formatMoney, USD_MONEY } from "@/lib/money";

/** Model-only boundary. Never use this on widgets, tool arguments or mutations.
 * Database calculations remain exact micros; models receive labelled USD strings.
 */
export function reportMoneyForModel(value: unknown, extraFields: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map(item => reportMoneyForModel(item, extraFields));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const monetary = /(?:Micros|_micros)$/.test(key) || extraFields.includes(key);
    if (!monetary) return [key, reportMoneyForModel(item, extraFields)];
    if (item !== null && (typeof item !== "number" || !Number.isSafeInteger(item))) {
      throw new Error("Report amount is not an exact supported micro-dollar value.");
    }
    const label = key.replace(/(?:Micros|_micros)$/, "") + "USD";
    return [label, item === null ? null : `${formatMoney(item as number, USD_MONEY)} USD`];
  }));
}
