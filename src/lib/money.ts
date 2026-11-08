/**
 * Money: one base unit in the database, one currency for people.
 *
 * Every amount in `products`, `orders`, `order_items` and the cart is an integer number of
 * **micro-dollars** – the base unit: 1 USD = 1,000,000 micros, so 1 cent = 10,000 micros and
 * a micro is a ten-thousandth of a cent. Settings → E-commerce → General → Currency decides
 * what people see: USD shows the base amount in cents, while any international currency shows
 * base × the configured USD→currency rate in its minor units. Prices typed into the admin are
 * converted back to micros before they are stored, so switching currency never rewrites the
 * catalogue – and the amount the admin typed is still the exact amount that comes back.
 *
 * Pure helpers – shared by server components, actions and client components.
 */
import type { SiteSettings } from "@/lib/types";

export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "CAD"
  | "AUD"
  | "SGD"
  | "CHF"
  | "AED"
  | "SAR"
  | "INR"
  | "BDT"
  | "MYR"
  | "BRL"
  | "MXN";

export const BASE_CURRENCY: CurrencyCode = "USD";

/** Base unit: 1 USD = 1,000,000 micros (1 cent = 10,000 micros). */
export const MICROS_PER_USD = 1_000_000;
export const MICROS_PER_CENT = 10_000;
/** Every base ↔ display conversion divides by this: micros × rate ÷ 10,000 = minor units (cents/pence/poisha). */
const DISPLAY_DIVISOR = MICROS_PER_CENT;

export type CurrencyMeta = {
  code: CurrencyCode;
  symbol: string;
  name: string;
  label: string;
  suggestedRate: number;
};

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: "USD", symbol: "$", name: "US dollar", label: "USD ($) — US dollar", suggestedRate: 1 },
  EUR: { code: "EUR", symbol: "€", name: "Euro", label: "EUR (€) — Euro", suggestedRate: 0.92 },
  GBP: { code: "GBP", symbol: "£", name: "British pound", label: "GBP (£) — British pound", suggestedRate: 0.79 },
  CAD: { code: "CAD", symbol: "CA$", name: "Canadian dollar", label: "CAD (CA$) — Canadian dollar", suggestedRate: 1.38 },
  AUD: { code: "AUD", symbol: "A$", name: "Australian dollar", label: "AUD (A$) — Australian dollar", suggestedRate: 1.52 },
  SGD: { code: "SGD", symbol: "S$", name: "Singapore dollar", label: "SGD (S$) — Singapore dollar", suggestedRate: 1.34 },
  CHF: { code: "CHF", symbol: "CHF ", name: "Swiss franc", label: "CHF — Swiss franc", suggestedRate: 0.88 },
  AED: { code: "AED", symbol: "AED ", name: "UAE dirham", label: "AED — UAE dirham", suggestedRate: 3.67 },
  SAR: { code: "SAR", symbol: "SAR ", name: "Saudi riyal", label: "SAR — Saudi riyal", suggestedRate: 3.75 },
  INR: { code: "INR", symbol: "₹", name: "Indian rupee", label: "INR (₹) — Indian rupee", suggestedRate: 84 },
  BDT: { code: "BDT", symbol: "৳", name: "Bangladeshi taka", label: "BDT (৳) — Bangladeshi taka", suggestedRate: 120 },
  MYR: { code: "MYR", symbol: "RM", name: "Malaysian ringgit", label: "MYR (RM) — Malaysian ringgit", suggestedRate: 4.45 },
  BRL: { code: "BRL", symbol: "R$", name: "Brazilian real", label: "BRL (R$) — Brazilian real", suggestedRate: 5.75 },
  MXN: { code: "MXN", symbol: "MX$", name: "Mexican peso", label: "MXN (MX$) — Mexican peso", suggestedRate: 20 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** Largest USD→currency rate the settings accept (a sanity bound, not a forecast). */
export const MAX_EXCHANGE_RATE = 100000;

/** Display currency + the base→display rate (always 1 for the base currency). */
export type Money = { currency: CurrencyCode; rate: number };

export const USD_MONEY: Money = { currency: "USD", rate: 1 };

/** The price the admin forms show as a placeholder/example: $19.99 in base micros. */
export const DEFAULT_PRICE_MICROS = usdMicros(19.99);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && value in CURRENCIES;
}

/** Whole dollars → base micros, for constants and seeds ("$5.00" → 5000000). */
export function usdMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

/**
 * The effective display currency from the settings row. Any non-USD currency needs a usable
 * positive rate – without one the store keeps showing USD rather than multiplying by nothing.
 */
export function moneyFromSettings(settings: Pick<SiteSettings, "currency" | "usd_to_bdt_rate">): Money {
  const rate = settings.usd_to_bdt_rate;
  if (
    isCurrencyCode(settings.currency) &&
    settings.currency !== BASE_CURRENCY &&
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    rate > 0
  ) {
    return { currency: settings.currency, rate };
  }
  return USD_MONEY;
}

/** The currency + rate an order was placed with (stamped by `place_order()`). */
export function orderMoney(order: { currency: string; exchange_rate?: number | string | null }): Money {
  const rate = Number(order.exchange_rate ?? 1);
  if (isCurrencyCode(order.currency) && order.currency !== BASE_CURRENCY && Number.isFinite(rate) && rate > 0) return { currency: order.currency, rate };
  return USD_MONEY;
}

/** Base micros → minor units of the display currency (cents, pence, euro-cents, poisha, etc.). */
export function toDisplayMinor(micros: number, money: Money): number {
  return Math.round((Number(micros) * money.rate) / DISPLAY_DIVISOR);
}

/** Minor units of the display currency → base micros (the inverse of `toDisplayMinor`). */
export function toBaseMicros(minor: number, money: Money): number {
  const micros = money.currency === BASE_CURRENCY ? minor * DISPLAY_DIVISOR : Math.round((minor * DISPLAY_DIVISOR) / money.rate);
  return Number(micros);
}

/**
 * "1,234.56" / "-5.00" – fixed en-US digit grouping, identical on the server and in the
 * browser (no locale-dependent output). `minor` is in the currency's minor unit.
 */
export function formatMinor(minor: number, currency: CurrencyCode): string {
  const sign = minor < 0 ? "-" : "";
  const amount = (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${CURRENCIES[currency].symbol}${amount}`;
}

/** Base micros → "$1,234.56" / "€1,135.80" / "৳148,147.20" in the given display currency. */
export function formatMoney(micros: number, money: Money = USD_MONEY): string {
  return formatMinor(toDisplayMinor(micros, money), money.currency);
}

/** Minor units → the plain number an `<input>` holds ("19.99"). */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Base micros → the string the admin price inputs hold ("2398.80" with BDT at 120). */
export function inputFromMicros(micros: number, money: Money): string {
  return minorToInput(toDisplayMinor(micros, money));
}

/** "19.99" / "1,299" → minor units; null when empty, NaN when not a non-negative number. */
export function parseMoneyInput(value: string): number | null {
  if (!value.trim()) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

/** "120" / "0.92" → a usable USD→currency rate (4 decimals), NaN when not positive. */
export function parseExchangeRate(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_EXCHANGE_RATE) return Number.NaN;
  return Math.round(n * 10000) / 10000;
}

/** "1 USD = 120 BDT" without trailing zeros ("121.5", not "121.5000"). */
export function formatExchangeRate(rate: number): string {
  return String(Math.round(rate * 10000) / 10000);
}
