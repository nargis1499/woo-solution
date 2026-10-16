/**
 * Column lists for every `products` query (storefront + admin). `type` / `sku` and the
 * variation tables arrived with migration 14 (`20261027000000_variations.sql`); until it has
 * run such a query fails, so the call sites retry with the legacy list below and the product
 * simply behaves like a simple product.
 */
import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";

const BASE =
  "id, category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, stock, is_active, is_featured, created_at, category:categories(id, name, slug)";

/** Catalogue / list columns, with the variable-product columns. */
export const PRODUCT_COLUMNS = `${BASE}, type, sku`;

/** Same list without `type` / `sku` (a database that has not run migration 14 yet). */
export const PRODUCT_COLUMNS_LEGACY = BASE;

const MEDIA_COLUMNS = `image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;

/** Product page: media embeds + attributes + variations. */
export const PRODUCT_DETAIL_COLUMNS = `${PRODUCT_COLUMNS}, ${MEDIA_COLUMNS}, attributes:product_attributes(id, product_id, name, options, sort_order), variations:product_variations(id, product_id, sku, price_micros, compare_at_price_micros, stock, is_active, image_url, image_media_id, combination, label, sort_order, image_media:media!product_variations_image_media_id_fkey(${MEDIA_REF_COLUMNS}))`;

/** Media embeds without the variation tables. */
export const PRODUCT_DETAIL_COLUMNS_LEGACY = `${PRODUCT_COLUMNS_LEGACY}, ${MEDIA_COLUMNS}`;

type QueryError = { code?: string; message?: string } | null;

const MISSING_VARIATIONS = /product_variations|product_attributes|"type"|"sku"|column .*products|schema cache/i;

/** True for the errors a database without migration 14 raises for these column lists. */
export const isMissingVariationSchema = (error: QueryError): boolean =>
  Boolean(error) &&
  (error!.code === "42703" || error!.code === "42P01" || /does not exist|schema cache/i.test(error!.message ?? "")) &&
  MISSING_VARIATIONS.test(`${error!.message ?? ""} ${error!.code ?? ""}`);
