/**
 * Store-wide configuration.
 *
 * Shipping numbers are mirrored in `supabase/migrations/20261026000000_money_micros.sql`
 * (`public.calculate_shipping`) — the database is the source of truth at checkout, these
 * values are only used to *preview* totals in the cart.
 */
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME ?? "Woo Solution";

// The display currency is a setting (Settings → WooCommerce → Currency). Amounts in this file
// and in the database are USD micro-dollars (1 USD = 1,000,000) — see src/lib/money.ts.
export const FLAT_SHIPPING_MICROS = 5_000_000; // $5.00
export const FREE_SHIPPING_THRESHOLD_MICROS = 50_000_000; // free at or above $50.00

export const MAX_QTY_PER_LINE = 10;

export type ShippingConfig = {
  enabled: boolean;
  rateMicros: number;
};

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  enabled: true,
  rateMicros: FLAT_SHIPPING_MICROS,
};

export function calculateShippingMicros(
  subtotalMicros: number,
  shipping: ShippingConfig = DEFAULT_SHIPPING_CONFIG,
): number {
  if (subtotalMicros <= 0 || !shipping.enabled) return 0;
  return Math.max(0, shipping.rateMicros);
}
