/**
 * Column lists for every `products` query (storefront + admin). `type` / `sku` and the
 * variation tables arrived with migration 14 (`20261027000000_variations.sql`), and `brand`
 * arrived with `20261039000000_product_brand.sql`; until those migrations have run such a
 * query falls back to the legacy column list so the site never crashes on an older database.
 */
import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";

const BASE =
  "id, category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, stock, is_active, is_featured, created_at, category:categories(id, name, slug)";

/** Catalogue / list columns, with `type`, `sku`, `brand`, `features`, and `quick_checkout`. */
export const PRODUCT_COLUMNS = `${BASE}, type, sku, brand, features, quick_checkout`;

/** Catalogue / list columns with `type` / `sku` but without `brand` / `features` / `quick_checkout`. */
export const PRODUCT_COLUMNS_NO_BRAND = `${BASE}, type, sku`;

/** Same list without `type` / `sku` / `brand` (a database before migration 14). */
export const PRODUCT_COLUMNS_LEGACY = BASE;

const MEDIA_COLUMNS = `image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;

const VARIATION_RELATIONS = `attributes:product_attributes(id, product_id, name, options, sort_order), variations:product_variations(id, product_id, sku, price_micros, compare_at_price_micros, stock, is_active, image_url, image_media_id, combination, label, sort_order, image_media:media!product_variations_image_media_id_fkey(${MEDIA_REF_COLUMNS}))`;

/** Product page: media embeds + attributes + variations + brand. */
export const PRODUCT_DETAIL_COLUMNS = `${PRODUCT_COLUMNS}, ${MEDIA_COLUMNS}, ${VARIATION_RELATIONS}`;

/** Product page without `brand`. */
export const PRODUCT_DETAIL_COLUMNS_NO_BRAND = `${PRODUCT_COLUMNS_NO_BRAND}, ${MEDIA_COLUMNS}, ${VARIATION_RELATIONS}`;

/** Media embeds without the variation tables. */
export const PRODUCT_DETAIL_COLUMNS_LEGACY = `${PRODUCT_COLUMNS_LEGACY}, ${MEDIA_COLUMNS}`;

type QueryError = { code?: string; message?: string } | null;

const MISSING_VARIATIONS = /product_variations|product_attributes|"type"|"sku"|"brand"|"features"|"quick_checkout"|column .*products|schema cache/i;

/** True for the errors a database without `brand`/`features`/`quick_checkout` or migration 14 raises for these column lists. */
export const isMissingVariationSchema = (error: QueryError): boolean =>
  Boolean(error) &&
  (error!.code === "42703" || error!.code === "42P01" || /does not exist|schema cache/i.test(error!.message ?? "")) &&
  MISSING_VARIATIONS.test(`${error!.message ?? ""} ${error!.code ?? ""}`);

export const isMissingBrandColumn = (error: QueryError): boolean =>
  Boolean(error) &&
  (error!.code === "42703" || /does not exist|schema cache/i.test(error!.message ?? "")) &&
  /\b(brand|features|quick_checkout)\b/i.test(`${error!.message ?? ""}`);
