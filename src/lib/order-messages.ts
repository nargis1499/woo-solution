import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sortOrderMessages } from "@/lib/order-chat";
import type { OrderMessage, OrderMessageAttachment } from "@/lib/types";

/**
 * Reads of the per-order inquiry thread. Every query runs through the request's own
 * Supabase client, so RLS decides who sees what: an order's owner, or an admin.
 */
export const ORDER_MESSAGE_COLUMNS =
  "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, attachment_url, attachment_name, attachment_type, attachment_size, created_at, delivered_at, seen_at";
/** Database without migration 47: same thread, no attachment columns yet. */
const ORDER_MESSAGE_COLUMNS_NO_ATTACH =
  "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, created_at, delivered_at, seen_at";
/** Database without migration 18: same thread, no read receipts. */
const ORDER_MESSAGE_COLUMNS_LEGACY =
  "id, order_id, sender_type, sender_id, sender_name, sender_avatar_url, message, created_at";

const ATTACHMENT_AVATAR_PREFIX = "__ATTACHMENT__:";

const needsNoAttachColumns = (error: unknown) => {
  const e = error as { message?: string; details?: string; code?: string } | null;
  return /attachment_url|attachment_name|attachment_type|attachment_size/i.test(
    `${e?.message ?? ""} ${e?.details ?? ""} ${e?.code ?? ""}`,
  );
};

const needsLegacyColumns = (error: unknown) => {
  const e = error as { message?: string; details?: string; code?: string } | null;
  return /delivered_at|seen_at/i.test(`${e?.message ?? ""} ${e?.details ?? ""} ${e?.code ?? ""}`);
};

type FallbackAttachmentPayload = {
  url: string;
  name: string;
  type: string;
  size: number;
  emptyCaption?: boolean;
};

export function normaliseOrderMessage(raw: Record<string, unknown>): OrderMessage {
  const row = { ...raw } as unknown as OrderMessage;
  if (
    !row.attachment_url &&
    typeof row.sender_avatar_url === "string" &&
    row.sender_avatar_url.startsWith(ATTACHMENT_AVATAR_PREFIX)
  ) {
    try {
      const parsed = JSON.parse(
        row.sender_avatar_url.slice(ATTACHMENT_AVATAR_PREFIX.length),
      ) as FallbackAttachmentPayload;
      if (parsed && typeof parsed.url === "string") {
        row.attachment_url = parsed.url;
        row.attachment_name = parsed.name || "attachment";
        row.attachment_type = parsed.type || "application/octet-stream";
        row.attachment_size = typeof parsed.size === "number" ? parsed.size : null;
        if (parsed.emptyCaption) {
          row.message = "";
        }
      }
    } catch {
      // ignore malformed fallback payload
    }
    row.sender_avatar_url = null;
  }
  return {
    ...row,
    attachment_url: row.attachment_url ?? null,
    attachment_name: row.attachment_name ?? null,
    attachment_type: row.attachment_type ?? null,
    attachment_size: row.attachment_size != null ? Number(row.attachment_size) : null,
  };
}

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

  // Full row first; fall back gracefully when older migrations are missing.
  let { data, error } = await load(ORDER_MESSAGE_COLUMNS);
  if (error && needsNoAttachColumns(error)) ({ data, error } = await load(ORDER_MESSAGE_COLUMNS_NO_ATTACH));
  if (error && needsLegacyColumns(error)) ({ data, error } = await load(ORDER_MESSAGE_COLUMNS_LEGACY));
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(normaliseOrderMessage);
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
  attachment?: OrderMessageAttachment | null;
}): Promise<OrderMessage> {
  const supabase = await createClient();
  const attachment = input.senderType === "admin" ? (input.attachment ?? null) : null;

  const { data, error } = await supabase
    .from("order_messages")
    .insert({
      order_id: input.orderId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      sender_name: input.senderName,
      sender_avatar_url: input.senderAvatarUrl,
      message: input.message,
      attachment_url: attachment?.url ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_type: attachment?.type ?? null,
      attachment_size: attachment?.size ?? null,
    })
    .select(ORDER_MESSAGE_COLUMNS)
    .single();

  if (!error && data) {
    return normaliseOrderMessage(data as unknown as Record<string, unknown>);
  }

  // Fallback for a database that has not run migration 47 yet:
  if (error && (needsNoAttachColumns(error) || /order_messages_message_check/i.test(`${error.message ?? ""} ${error.details ?? ""}`))) {
    const emptyCaption = !input.message.trim();
    const fallbackMessage = emptyCaption && attachment
      ? `📎 ${attachment.name}`.slice(0, 200)
      : input.message;
    const fallbackAvatar = attachment
      ? `${ATTACHMENT_AVATAR_PREFIX}${JSON.stringify({
          url: attachment.url,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          emptyCaption,
        } satisfies FallbackAttachmentPayload)}`
      : input.senderAvatarUrl;

    const retry = await supabase
      .from("order_messages")
      .insert({
        order_id: input.orderId,
        sender_type: input.senderType,
        sender_id: input.senderId,
        sender_name: input.senderName,
        sender_avatar_url: fallbackAvatar,
        message: fallbackMessage,
      })
      .select(ORDER_MESSAGE_COLUMNS_NO_ATTACH)
      .single();

    if (retry.error) throw retry.error;
    return normaliseOrderMessage(retry.data as unknown as Record<string, unknown>);
  }

  throw error;
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
