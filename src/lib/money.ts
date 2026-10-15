/**
 * Money: one base currency in the database, one display currency for people.
 *
 * Every amount in `products`, `orders` and the cart is a **USD cent** (the base
 * currency). Settings → WooCommerce → Currency picks what customers and admins see:
 * USD shows the base amounts, BDT shows base × the USD→BDT rate. Prices typed into
 * the admin while BDT is selected are converted back to USD cents before they are
 * stored, so switching the currency never rewrites the catalogue.
 *
 * Pure helpers – shared by server components, actions and client components.
 */
import type { SiteSettings } from "@/lib/types";

export type CurrencyCode = "USD" | "BDT";

export const BASE_CURRENCY: CurrencyCode = "USD";

export const CURRENCIES: Record<CurrencyCode, { code: CurrencyCode; symbol: string; name: string; label: string }> = {
  USD: { code: "USD", symbol: "$", name: "US dollar", label: "USD ($)" },
  BDT: { code: "BDT", symbol: "৳", name: "Bangladeshi taka", label: "BDT (৳)" },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** Largest USD→BDT rate the settings accept (a sanity bound, not a forecast). */
export const MAX_EXCHANGE_RATE = 100000;

/** Display currency + the base→display rate (always 1 for the base currency). */
export type Money = { currency: CurrencyCode; rate: number };

export const USD_MONEY: Money = { currency: "USD", rate: 1 };

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && value in CURRENCIES;
}

/**
 * The effective display currency from the settings row. BDT needs a usable rate –
 * without one the store keeps showing USD rather than multiplying by nothing.
 */
export function moneyFromSettings(settings: Pick<SiteSettings, "currency" | "usd_to_bdt_rate">): Money {
  const rate = settings.usd_to_bdt_rate;
  if (settings.currency === "BDT" && typeof rate === "number" && Number.isFinite(rate) && rate > 0) return { currency: "BDT", rate };
  return USD_MONEY;
}

/** The currency + rate an order was placed with (stamped by `place_order()`). */
export function orderMoney(order: { currency: string; exchange_rate?: number | string | null }): Money {
  const rate = Number(order.exchange_rate ?? 1);
  if (isCurrencyCode(order.currency) && order.currency !== BASE_CURRENCY && Number.isFinite(rate) && rate > 0) return { currency: order.currency, rate };
  return USD_MONEY;
}

/** Base (USD) cents → cents of the display currency. */
export function toDisplayCents(baseCents: number, money: Money): number {
  return money.currency === BASE_CURRENCY ? baseCents : Math.round(baseCents * money.rate);
}

/** Cents of the display currency → base (USD) cents. */
export function toBaseCents(displayCents: number, money: Money): number {
  return money.currency === BASE_CURRENCY ? displayCents : Math.round(displayCents / money.rate);
}

/**
 * "$1,234.56" / "৳1,234.56" / "-$5.00" – fixed en-US digit grouping with the currency's
 * own symbol, identical on the server and in the browser (no locale-dependent output).
 */
export function formatCents(displayCents: number, currency: CurrencyCode): string {
  const sign = displayCents < 0 ? "-" : "";
  const amount = (Math.abs(displayCents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${CURRENCIES[currency].symbol}${amount}`;
}

/** Base (USD) cents → formatted amount in the display currency. */
export function formatMoney(baseCents: number, money: Money = USD_MONEY): string {
  return formatCents(toDisplayCents(baseCents, money), money.currency);
}

/** Cents → the plain number an `<input>` holds ("19.99"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "19.99" / "1,299" → cents; null when empty, NaN when not a non-negative number. */
export function parseMoneyInput(value: string): number | null {
  if (!value.trim()) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

/** "120" / "121.5" → a usable USD→BDT rate (4 decimals), NaN when not positive. */
export function parseExchangeRate(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_EXCHANGE_RATE) return Number.NaN;
  return Math.round(n * 10000) / 10000;
}

/** "1 USD = 120 BDT" without trailing zeros ("121.5", not "121.5000"). */
export function formatExchangeRate(rate: number): string {
  return String(Math.round(rate * 10000) / 10000);
}
