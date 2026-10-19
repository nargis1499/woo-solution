import type { Product, ProductVariation } from "@/lib/types";

export const DEFAULT_QUICK_CHECKOUT_QUANTITIES = [1, 2, 5, 10, 20, 50, 100] as const;

export type QuickCheckoutTier = {
  id: string;
  quantity: number;
  /** Display heading on the tier card, e.g. "5x" */
  title: string;
  /** Total price for this tier in USD micros */
  priceMicros: number;
  /** Optional regular/compare-at price in USD micros */
  compareAtPriceMicros: number | null;
  /** Per-unit price in USD micros */
  unitPriceMicros: number;
  /** Short helper caption below the price */
  subtitle: string;
  /** Highlights the tier with a "POPULAR" pill badge */
  popular?: boolean;
  /** Underlying product variation id when backed by a variable product */
  variationId?: string | null;
};

/**
 * Extracts a positive integer quantity from an attribute value like "2", "5x", "10", "20", "50", "100".
 */
export function parseQuantityFromText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const match = /\b(\d+)\b/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null;
}

function defaultSubtitleForQuantity(qty: number, index: number, total: number): string {
  if (qty === 1) return "Single Unit";
  if (qty === 2) return "Test Order";
  if (qty === 5) return "Standard Pack";
  if (qty === 10) return "Value Pack";
  if (qty === 20) return "Best Value";
  if (qty === 50) return "Agency Choice";
  if (qty >= 100) return "Max Volume";
  if (index === 0) return "Starter Pack";
  if (index === total - 1) return "Bulk Pack";
  return `${qty} Units`;
}

/**
 * Resolves the selectable Quantity Tiers for a product in the Quick Checkout modal:
 * 1. If the product is a variable product (`type === "variable"`) AND has an attribute
 *    explicitly marked by the admin with `is_quantity === true`, builds the tiers from
 *    that Quantity attribute's options and matching variations.
 * 2. Otherwise (Simple products, or Variable products with no Quantity field selected),
 *    applies the default quantity pattern: (1, 2, 5, 10, 20, 50, 100).
 */
export function resolveQuickCheckoutTiers(product: Product): QuickCheckoutTier[] {
  const qtyAttr =
    product.type === "variable"
      ? (product.attributes ?? []).find((a) => Boolean(a.is_quantity))
      : undefined;

  if (qtyAttr) {
    const activeVariations = (product.variations ?? []).filter(
      (v) => v.is_active !== false,
    );
    const attrNameLower = qtyAttr.name.trim().toLowerCase();

    // Match variations by their value for the designated Quantity attribute
    const variationByQty = new Map<number, ProductVariation>();
    for (const v of activeVariations) {
      const combo = v.combination ?? {};
      let rawVal: string | undefined;
      for (const [k, val] of Object.entries(combo)) {
        if (k.trim().toLowerCase() === attrNameLower) {
          rawVal = val;
          break;
        }
      }
      const qty = parseQuantityFromText(rawVal ?? v.label);
      if (qty !== null) {
        const existing = variationByQty.get(qty);
        if (!existing || v.price_micros < existing.price_micros) {
          variationByQty.set(qty, v);
        }
      }
    }

    // Collect quantities from the attribute's configured options (plus any active variation quantities)
    const optionQuantities = (qtyAttr.options ?? [])
      .map((opt) => parseQuantityFromText(opt))
      .filter((n): n is number => n !== null && n > 0);
    const allQuantities = [
      ...new Set([...optionQuantities, ...variationByQty.keys()]),
    ].sort((a, b) => a - b);

    if (allQuantities.length > 0) {
      const popularIndex =
        allQuantities.length >= 3 ? Math.min(2, Math.floor(allQuantities.length / 2)) : -1;
      const baseUnitMicros = Math.max(0, product.price_micros);

      return allQuantities.map((qty, idx) => {
        const matchedVar = variationByQty.get(qty);
        const priceMicros = matchedVar ? matchedVar.price_micros : baseUnitMicros * qty;
        const compareAtPriceMicros = matchedVar
          ? (matchedVar.compare_at_price_micros ?? null)
          : product.compare_at_price_micros != null
            ? product.compare_at_price_micros * qty
            : null;
        const unitPriceMicros = Math.max(0, Math.round(priceMicros / Math.max(1, qty)));

        return {
          id: matchedVar ? matchedVar.id : `qty-${qty}`,
          quantity: qty,
          title: `${qty}x`,
          priceMicros,
          compareAtPriceMicros,
          unitPriceMicros,
          subtitle: defaultSubtitleForQuantity(qty, idx, allQuantities.length),
          popular: idx === popularIndex,
          variationId: matchedVar?.id ?? null,
        };
      });
    }
  }

  // Default quantity pattern for Simple products or Variable products without a Quantity attribute selected:
  // (1, 2, 5, 10, 20, 50, 100)
  const baseUnitMicros = Math.max(0, product.price_micros);
  return DEFAULT_QUICK_CHECKOUT_QUANTITIES.map((qty, idx) => ({
    id: `default-qty-${qty}`,
    quantity: qty,
    title: `${qty}x`,
    priceMicros: baseUnitMicros * qty,
    compareAtPriceMicros:
      product.compare_at_price_micros != null
        ? product.compare_at_price_micros * qty
        : null,
    unitPriceMicros: baseUnitMicros,
    subtitle: defaultSubtitleForQuantity(
      qty,
      idx,
      DEFAULT_QUICK_CHECKOUT_QUANTITIES.length,
    ),
    popular: qty === 10,
    variationId: null,
  }));
}
