import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";
import { BASE_ORDER_COLUMNS, ORDER_COLUMNS, ORDER_ITEM_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY, withOrderColumns } from "./order-columns";

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
  const load = (orderColumns: string, itemColumns: string) =>
    supabase
      .from("orders")
      .select(`${orderColumns}, order_items(${itemColumns})`)
      .eq("id", id)
      .maybeSingle();

  // Full row first; a database without the newest migrations falls back one column group at a time.
  let { data, error } = await load(ORDER_COLUMNS, ORDER_ITEM_COLUMNS);
  if (error && /variation_(id|label)/i.test(`${error.message} ${error.code}`)) ({ data, error } = await load(ORDER_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY));
  if (error && /exchange_rate/i.test(`${error.message} ${error.code}`)) ({ data, error } = await load(BASE_ORDER_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY));

  if (error) {
    // invalid uuid → PostgREST error 22P02; treat as not found
    if (error.code === "22P02") return null;
    throw new Error(`Failed to load order: ${error.message}`);
  }
  return (data as unknown as Order) ?? null;
}
