import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";

const ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, subtotal_cents, shipping_cents, total_cents, customer_email, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, notes, created_at";

/** Orders of the signed-in user (RLS guarantees we only ever see our own). */
export async function getMyOrders(): Promise<Order[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(`${ORDER_COLUMNS}, order_items(id, product_name, quantity)`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return (data ?? []) as unknown as Order[];
}

export async function getMyOrder(id: string): Promise<Order | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `${ORDER_COLUMNS}, order_items(id, order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity, line_total_cents)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // invalid uuid → PostgREST error 22P02; treat as not found
    if (error.code === "22P02") return null;
    throw new Error(`Failed to load order: ${error.message}`);
  }
  return (data as unknown as Order) ?? null;
}
