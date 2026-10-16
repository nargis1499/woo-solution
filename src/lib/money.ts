/**
 * Money: one base unit in the database, one currency for people.
 *
 * Every amount in `products`, `orders`, `order_items` and the cart is an integer number of
 * **micro-dollars** – the base unit: 1 USD = 1,000,000 micros, so 1 cent = 10,000 micros and
 * a micro is a ten-thousandth of a cent. Settings → WooCommerce → Currency decides what people
 * see: USD shows the base amount in cents, BDT shows base × the USD→BDT rate in poisha. Prices
 * typed into the admin while BDT is selected are converted back to micros before they are
 * stored, so switching currency never rewrites the catalogue – and the taka amount the admin
 * typed is still the exact amount that comes back.
 *
 * A whole *cent* is too coarse for that. At a rate of 120 one cent is 1.20 ৳, so 100 ৳ would
 * have to be stored as 83 ¢ and would read back as 99.60 ৳ (and 1 ৳ as 1.20 ৳). A micro-dollar
 * is 0.00012 ৳ at the same rate, so any amount an admin can type round-trips exactly while it
 * stays a safe JavaScript integer (Postgres columns are `bigint`, good for ~$9,000,000).
 *
 * Pure helpers – shared by server components, actions and client components.
 */
import type { SiteSettings } from "@/lib/types";

export type CurrencyCode = "USD" | "BDT";

export const BASE_CURRENCY: CurrencyCode = "USD";

/** Base unit: 1 USD = 1,000,000 micros (1 cent = 10,000 micros). */
export const MICROS_PER_USD = 1_000_000;
export const MICROS_PER_CENT = 10_000;
/** Every base ↔ display conversion divides by this: micros × rate ÷ 10,000 = cents/poisha. */
const DISPLAY_DIVISOR = MICROS_PER_CENT;

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

/** Base micros → minor units of the display currency (cents for USD, poisha for BDT). */
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

/** Base micros → "$1,234.56" / "৳148,147.20" in the given display currency. */
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
