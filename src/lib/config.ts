/**
 * Store-wide configuration.
 *
 * Shipping numbers are mirrored in `supabase/migrations/*_init.sql`
 * (`public.calculate_shipping`) — the database is the source of truth at
 * checkout, these values are only used to *preview* totals in the cart.
 */
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME ?? "Woo Solution";

export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "USD";

export const FLAT_SHIPPING_CENTS = 500; // 5.00
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000; // free at or above 50.00

export const MAX_QTY_PER_LINE = 10;

export function calculateShippingCents(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}
