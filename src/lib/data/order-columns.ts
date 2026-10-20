/**
 * Column lists shared by every `orders` query (storefront + admin).
 *
 * Later migrations added columns a database may not have yet:
 *   * `exchange_rate`      – migration 12 (`20261025000000_currency.sql`)
 *   * `variation_id`/`variation_label` on `order_items` – migration 14
 *   * `payment_protocol`, `payment_network`, `payment_address`, `payment_tx_id` – migration 43
 * A query naming a missing column fails, so `withOrderColumns` and `withOrderItemColumns`
 * retry without them.
 */
export const BASE_ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, subtotal_micros, shipping_micros, total_micros, customer_email, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, notes, created_at";

export const ORDER_COLUMNS_NO_PAYMENT = `${BASE_ORDER_COLUMNS}, exchange_rate`;
export const ORDER_COLUMNS = `${ORDER_COLUMNS_NO_PAYMENT}, payment_protocol, payment_network, payment_address, payment_tx_id`;

/** `order_items` columns for the order detail views (variation columns arrived with migration 14). */
export const ORDER_ITEM_COLUMNS =
  "id, order_id, product_id, product_name, product_slug, image_url, unit_price_micros, quantity, line_total_micros, variation_id, variation_label";
export const ORDER_ITEM_COLUMNS_LEGACY = "id, order_id, product_id, product_name, product_slug, image_url, unit_price_micros, quantity, line_total_micros";

type QueryError = { code?: string; message?: string } | null;

const mentions = (error: QueryError, re: RegExp): boolean =>
  Boolean(error) && (error!.code === "42703" || error!.code === "42P01" || re.test(error!.message ?? "")) && re.test(`${error!.message ?? ""} ${error!.code ?? ""}`);

const isMissingPaymentColumns = (error: QueryError): boolean =>
  Boolean(error) && (error!.code === "42703" || /payment_(protocol|network|address|tx_id)/i.test(error!.message ?? ""));
const isMissingExchangeRate = (error: QueryError): boolean => Boolean(error) && (error!.code === "42703" || /exchange_rate/i.test(error!.message ?? ""));
const isMissingVariationColumns = (error: QueryError): boolean => mentions(error, /variation_(id|label)/i);

/** Runs `query` with the full column list, falling back if payment columns or exchange_rate are missing. */
export async function withOrderColumns<T extends { error: QueryError }>(query: (columns: string) => PromiseLike<T>): Promise<T> {
  let result = await query(ORDER_COLUMNS);
  if (result.error && isMissingPaymentColumns(result.error)) {
    result = await query(ORDER_COLUMNS_NO_PAYMENT);
  }
  if (result.error && isMissingExchangeRate(result.error)) {
    return query(BASE_ORDER_COLUMNS);
  }
  return result;
}

/** Runs `query` with the full `order_items` column list, retrying without the variation columns. */
export async function withOrderItemColumns<T extends { error: QueryError }>(query: (columns: string) => PromiseLike<T>): Promise<T> {
  const result = await query(ORDER_ITEM_COLUMNS);
  if (result.error && isMissingVariationColumns(result.error)) return query(ORDER_ITEM_COLUMNS_LEGACY);
  return result;
}
