/**
 * Variable products: attributes, combinations and the variation matrix.
 *
 * Pure helpers shared by the admin form (client), the server actions and the
 * storefront. Nothing here touches the database – the tables are
 * `product_attributes` / `product_variations` (see
 * supabase/migrations/20261027000000_variations.sql).
 */
import type { ProductAttribute, ProductVariation } from "@/lib/types";

/** The slice the admin form edits before anything is saved. */
export type DraftAttribute = { name: string; options: string[] };
/**
 * The slice of a variation the admin form edits. Prices are the strings the admin sees
 * (display currency) – the server action converts them to USD micros.
 */
export type DraftVariation = {
  /** Client-only stable React key (never submitted). */
  key: string;
  /** Existing row id, kept so the save updates it instead of re-inserting. */
  id?: string;
  sku: string;
  /** Value in the store's display currency, e.g. "2398.80" */
  price: string;
  compareAtPrice: string;
  stock: string;
  is_active: boolean;
  /** Media Library file chosen for this variation ("" when none). */
  image_media_id: string;
  /** External image URL, used when no library file is chosen. */
  image_url: string;
  /** Client-only thumbnail (never submitted). */
  image_preview: string;
  combination: Record<string, string>;
};

/** What actually travels to the server action in `variations_json`. */
export type SubmittedVariation = Omit<DraftVariation, "key" | "image_preview" | "sku"> & { sku: string | null };

/** Strips the client-only fields before serialising the rows into the form. */
export function submittedVariations(rows: DraftVariation[]): SubmittedVariation[] {
  return rows.map((row) => {
    const { key, image_preview, ...rest } = row;
    void key;
    void image_preview;
    return rest;
  });
}

export const MAX_ATTRIBUTES = 5;
export const MAX_ATTRIBUTE_OPTIONS = 30;
export const MAX_VARIATIONS = 200;

/** Trimmed, de-duplicated (case-insensitive) list of attribute values. */
export function cleanOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const value = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Attributes that can actually be used: a name and at least one value. */
export function usableAttributes(attributes: DraftAttribute[]): DraftAttribute[] {
  return attributes
    .map((a) => ({ name: a.name.trim().slice(0, 60), options: cleanOptions(a.options) }))
    .filter((a) => a.name.length > 0 && a.options.length > 0);
}

/**
 * Every combination of the given attributes – the cartesian product, in a stable
 * order (last attribute varies fastest):
 *   [Color: Red, Blue], [Size: S, M]  →  Red/S, Red/M, Blue/S, Blue/M
 */
export function generateCombinations(attributes: DraftAttribute[]): Record<string, string>[] {
  let combinations: Record<string, string>[] = [{}];
  for (const attribute of usableAttributes(attributes)) {
    combinations = combinations.flatMap((combo) =>
      attribute.options.map((value) => ({ ...combo, [attribute.name]: value })),
    );
    if (combinations.length > MAX_VARIATIONS) return combinations.slice(0, MAX_VARIATIONS);
  }
  return attributes.length ? combinations : [];
}

/** "Red / Small" – the option values in the order of the attributes. */
export function combinationLabel(combination: Record<string, string>, attributeNames: string[]): string {
  const names = attributeNames.length ? attributeNames : Object.keys(combination);
  return names.map((n) => combination[n]).filter(Boolean).join(" / ");
}

/** Same attribute → value pairs (order-independent) – used to match rows across regenerations. */
export function sameCombination(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return true;
}

/** "red-small" style fragment for SKU suggestions. */
export function slugPart(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * A suggested SKU: the product SKU (or slug) plus one fragment per attribute value,
 * e.g. `TEE-RED-S`. Always upper-case, always something the admin can overwrite.
 */
export function suggestSku(base: string, combination: Record<string, string>, attributeNames: string[]): string {
  const names = attributeNames.length ? attributeNames : Object.keys(combination);
  const parts = names
    .map((n) => combination[n])
    .filter(Boolean)
    .map((v) => slugPart(String(v)).toUpperCase())
    .filter(Boolean);
  const prefix = (slugPart(base) || "product").toUpperCase().slice(0, 24);
  return [prefix, ...parts].join("-").slice(0, 64);
}

/** Attributes + variations from a raw product row (PostgREST embeds), in display order. */
export function withSortedVariations<T extends { attributes?: ProductAttribute[] | null; variations?: ProductVariation[] | null }>(product: T): T {
  const attributes = [...(product.attributes ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const variations = [...(product.variations ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return { ...product, attributes, variations };
}

/* ── Storefront helpers ────────────────────────────────────────────────────── */

/** Variations a customer may buy right now. */
export function buyableVariations(product: { variations?: ProductVariation[] | null }): ProductVariation[] {
  return (product.variations ?? []).filter((v) => v.is_active);
}

/** The variation matching a full set of attribute values, or null. */
export function findVariation(
  variations: ProductVariation[],
  selection: Record<string, string>,
): ProductVariation | null {
  const chosen = Object.entries(selection).filter(([, value]) => value);
  if (!chosen.length) return null;
  return (
    variations.find((v) => chosen.every(([name, value]) => v.combination[name] === value)) ?? null
  );
}

/** Cheapest / dearest enabled variation – drives the "From …" price. */
export function priceRange(variations: ProductVariation[]): { min: number; max: number } | null {
  const enabled = variations.filter((v) => v.is_active);
  if (!enabled.length) return null;
  return {
    min: Math.min(...enabled.map((v) => v.price_micros)),
    max: Math.max(...enabled.map((v) => v.price_micros)),
  };
}

/** Buyable combinations keyed by `Color=Red|Size=S` – lets the PDP grey out impossible picks. */
export function combinationKey(selection: Record<string, string>): string {
  return Object.entries(selection)
    .filter(([, value]) => value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join("|");
}
