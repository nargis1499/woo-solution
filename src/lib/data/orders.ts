import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";
import { withOrderColumns } from "./order-columns";

/** Orders of the signed-in user (RLS guarantees we only ever see our own). */
export async function getMyOrders(): Promise<Order[]> {
  const supabase = await createClient();
  const { data, error } = await withOrderColumns((columns) =>
    supabase
      .from("orders")
      .select(`${columns}, order_items(id, product_name, quantity)`)
      .order("created_at", { ascending: false }),
  );

  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return (data ?? []) as unknown as Order[];
}

export async function getMyOrder(id: string): Promise<Order | null> {
  const supabase = await createClient();
  const { data, error } = await withOrderColumns((columns) =>
    supabase
      .from("orders")
      .select(`${columns}, order_items(id, order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity, line_total_cents)`)
      .eq("id", id)
      .maybeSingle(),
  );

  if (error) {
    // invalid uuid → PostgREST error 22P02; treat as not found
    if (error.code === "22P02") return null;
    throw new Error(`Failed to load order: ${error.message}`);
  }
  return (data as unknown as Order) ?? null;
}
