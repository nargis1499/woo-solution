import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sortOrderMessages } from "@/lib/order-chat";
import type { OrderMessage } from "@/lib/types";

/**
 * Reads of the per-order inquiry thread. Every query runs through the request's own
 * Supabase client, so RLS decides who sees what: an order's owner, or an admin.
 */
export const ORDER_MESSAGE_COLUMNS = "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, created_at";

/** Newest threads are short; this is only a guard against a runaway one. */
const MAX_MESSAGES = 500;

/**
 * Messages of one order, oldest first.
 * `since` (an ISO timestamp) returns only what was written after it – the SSE stream uses
 * it to catch up on whatever happened while a tab was closed.
 */
export async function listOrderMessages(orderId: string, since?: string | null): Promise<OrderMessage[]> {
  const supabase = await createClient();
  let query = supabase
    .from("order_messages")
    .select(ORDER_MESSAGE_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_MESSAGES);
  if (since) query = query.gt("created_at", since);

  const { data, error } = await query;
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

/** The thread as the API routes see it – sorted oldest first after a `since` slice. */
export async function listOrderMessagesSince(orderId: string, since: string | null): Promise<OrderMessage[]> {
  return sortOrderMessages(await listOrderMessages(orderId, since));
}
