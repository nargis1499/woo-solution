import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sortOrderMessages } from "@/lib/order-chat";
import type { OrderMessage } from "@/lib/types";

/**
 * Reads of the per-order inquiry thread. Every query runs through the request's own
 * Supabase client, so RLS decides who sees what: an order's owner, or an admin.
 */
export const ORDER_MESSAGE_COLUMNS = "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, created_at, delivered_at, seen_at";
/** Database without migration 18: same thread, no read receipts. */
const ORDER_MESSAGE_COLUMNS_LEGACY = "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, created_at";

const needsLegacyColumns = (error: unknown) => {
  const e = error as { message?: string; details?: string; code?: string } | null;
  return /delivered_at|seen_at/i.test(`${e?.message ?? ""} ${e?.details ?? ""} ${e?.code ?? ""}`);
};

/** Newest threads are short; this is only a guard against a runaway one. */
const MAX_MESSAGES = 500;

/**
 * Messages of one order, oldest first.
 * `since` (an ISO timestamp) returns only what was written after it – the SSE stream uses
 * it to catch up on whatever happened while a tab was closed.
 */
export async function listOrderMessages(orderId: string, since?: string | null, client?: SupabaseClient): Promise<OrderMessage[]> {
  const supabase = client ?? (await createClient());
  const load = (columns: string) => {
    let query = supabase
      .from("order_messages")
      .select(columns)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_MESSAGES);
    if (since) query = query.gt("created_at", since);
    return query;
  };

  // Full row first; a database that has not run migration 18 falls back without the receipt columns.
  let { data, error } = await load(ORDER_MESSAGE_COLUMNS);
  if (error && needsLegacyColumns(error)) ({ data, error } = await load(ORDER_MESSAGE_COLUMNS_LEGACY));
  if (error) throw error;
  return (data ?? []) as unknown as OrderMessage[];
}

/** True when the error is just "migration 17 has not been run yet". */
export function isMissingOrderMessagesError(error: unknown): boolean {
  const e = error as { message?: string; code?: string; details?: string } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;
  return /order_messages/i.test(text) && /does not exist|schema cache|Could not find/i.test(text);
}

/**
 * Page helper: the thread, or `null` when the table is missing (an older database).
 * Callers then simply leave the chat out instead of failing the whole order page.
 */
export async function listOrderMessagesOrNull(orderId: string): Promise<OrderMessage[] | null> {
  try {
    return await listOrderMessages(orderId);
  } catch (e) {
    if (isMissingOrderMessagesError(e)) return null;
    throw e;
  }
}

/** Insert a message as the signed-in user; RLS only accepts their own side of the thread. */
export async function insertOrderMessage(input: {
  orderId: string;
  senderType: "customer" | "admin";
  senderId: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  message: string;
}): Promise<OrderMessage> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_messages")
    .insert({
      order_id: input.orderId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      sender_name: input.senderName,
      sender_avatar_url: input.senderAvatarUrl,
      message: input.message,
    })
    .select(ORDER_MESSAGE_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as OrderMessage;
}

/**
 * Read receipts: the **recipient** stamps the other side's messages.
 *
 *   delivered → the message reached one of their open tabs
 *   seen      → that tab was actually visible (seen also implies delivered)
 *
 * Only rows that are still unstamped are touched, so the first timestamp wins and a
 * reconnect cannot move it. Returns the ids it changed – the caller broadcasts them.
 */
export async function markOrderMessagesReceived(
  orderId: string,
  viewer: "customer" | "admin",
  status: "delivered" | "seen",
): Promise<{ ids: string[]; at: string }> {
  const at = new Date().toISOString();
  const supabase = await createClient();
  // a customer stamps admin messages and vice versa
  const other = viewer === "customer" ? "admin" : "customer";

  /**
   * One stamp at a time: the database keeps messages immutable and refuses to rewrite a
   * receipt that is already set (see the trigger in migration 19), so `seen` writes only
   * `seen_at` and then fills a still-missing `delivered_at` separately.
   */
  const stamp = async (column: "delivered_at" | "seen_at") => {
    const { data, error } = await supabase
      .from("order_messages")
      .update({ [column]: at })
      .eq("order_id", orderId)
      .eq("sender_type", other)
      .is(column, null)
      .select("id");
    if (error) {
      if (needsLegacyColumns(error)) return [] as string[]; // no receipt columns → nothing to stamp
      throw error;
    }
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  };

  if (status === "delivered") return { ids: await stamp("delivered_at"), at };

  const ids = await stamp("seen_at");
  await stamp("delivered_at"); // seen implies delivered – only where the stamp is still missing
  return { ids, at };
}

/** The thread as the API routes see it – sorted oldest first after a `since` slice. */
export async function listOrderMessagesSince(orderId: string, since: string | null, client?: SupabaseClient): Promise<OrderMessage[]> {
  return sortOrderMessages(await listOrderMessages(orderId, since, client));
}
