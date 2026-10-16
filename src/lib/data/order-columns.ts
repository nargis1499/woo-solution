/**
 * Column list shared by every `orders` query (storefront + admin). `exchange_rate` arrived
 * with migration 12 (`20261025000000_currency.sql`); until it has run, a query naming the
 * column fails, so `withOrderColumns` retries without it and such orders display as USD.
 */
const BASE_ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, subtotal_micros, shipping_micros, total_micros, customer_email, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, notes, created_at";

export const ORDER_COLUMNS = `${BASE_ORDER_COLUMNS}, exchange_rate`;

type QueryError = { code?: string; message?: string } | null;

const isMissingExchangeRate = (error: QueryError): boolean =>
  Boolean(error) && (error!.code === "42703" || /exchange_rate/i.test(error!.message ?? ""));

/** Runs `query` with the full column list, once more with the legacy one if the DB predates migration 12. */
export async function withOrderColumns<T extends { error: QueryError }>(query: (columns: string) => PromiseLike<T>): Promise<T> {
  const result = await query(ORDER_COLUMNS);
  if (result.error && isMissingExchangeRate(result.error)) return query(BASE_ORDER_COLUMNS);
  return result;
}
