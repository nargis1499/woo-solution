/**
 * Store-wide configuration.
 *
 * Shipping numbers are mirrored in `supabase/migrations/20261064000000_international_shipping_tracking.sql`
 * (`public.calculate_shipping`) — the database is the source of truth at checkout, these
 * values are only used to *preview* totals in the cart.
 */
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME ?? "Woo Solution";
export const DEFAULT_FOOTER_TEXT = "Built with Next.js, Supabase and shadcn/ui.";

// The display currency is a setting (Settings → E-commerce → General → Currency). Amounts in this file
// and in the database are USD micro-dollars (1 USD = 1,000,000) — see src/lib/money.ts.
export const FLAT_SHIPPING_MICROS = 5_000_000; // $5.00
export const FREE_SHIPPING_THRESHOLD_MICROS = 50_000_000; // free at or above $50.00

export const MAX_QTY_PER_LINE = 10;

export type ShippingConfig = {
  enabled: boolean;
  rateMicros: number;
  freeThresholdMicros?: number | null;
};

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  enabled: true,
  rateMicros: FLAT_SHIPPING_MICROS,
  freeThresholdMicros: null,
};

export function calculateShippingMicros(
  subtotalMicros: number,
  shipping: ShippingConfig = DEFAULT_SHIPPING_CONFIG,
): number {
  if (subtotalMicros <= 0 || !shipping.enabled) return 0;
  const threshold = shipping.freeThresholdMicros;
  if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0 && subtotalMicros >= threshold) {
    return 0;
  }
  return Math.max(0, shipping.rateMicros);
}

export type ShippingThresholdStatus = {
  active: boolean;
  unlocked: boolean;
  thresholdMicros: number;
  remainingMicros: number;
  progressPercent: number;
};

export function getShippingThresholdStatus(
  subtotalMicros: number,
  shipping: ShippingConfig = DEFAULT_SHIPPING_CONFIG,
): ShippingThresholdStatus | null {
  const threshold = shipping.freeThresholdMicros;
  if (
    !shipping.enabled ||
    shipping.rateMicros <= 0 ||
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold <= 0
  ) {
    return null;
  }
  const clampedSubtotal = Math.max(0, subtotalMicros);
  const remainingMicros = Math.max(0, threshold - clampedSubtotal);
  const unlocked = clampedSubtotal >= threshold;
  const progressPercent = unlocked ? 100 : Math.min(99, Math.max(0, Math.round((clampedSubtotal / threshold) * 100)));
  return {
    active: true,
    unlocked,
    thresholdMicros: threshold,
    remainingMicros,
    progressPercent,
  };
}
