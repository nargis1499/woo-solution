import { getAdminStatus } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { CLOSED_THREAD_MESSAGE, MAX_ORDER_MESSAGE_LENGTH, isOrderChatOpen, orderChatTurn } from "@/lib/order-chat";
import { publishOrderChat } from "@/lib/order-chat-bus";
import { insertOrderMessage, isMissingOrderMessagesError, listOrderMessagesSince } from "@/lib/order-messages";
import type { OrderStatus } from "@/lib/types";

/**
 * The order inquiry thread — one endpoint for both sides.
 *
 *   GET  /api/orders/[id]/chat            → { messages } (optionally `?since=<ISO>`)
 *   POST /api/orders/[id]/chat            → { message } – validated, stored, then pushed
 *                                           to every open SSE stream of that order
 *
 * A customer only ever reaches their own order (RLS) and may post again only after an
 * admin replied; an admin may post any number of messages. 200 characters, both sides.
 */

type Params = { params: Promise<{ id: string }> };

const MISSING_TABLE = "The inquiry table is missing – run supabase/migrations/20261030000000_order_messages.sql in the Supabase SQL Editor, then try again.";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Session + order in one step. `null` order means "not found, or not yours". */
async function loadOrder(id: string) {
  const { user, isAdmin } = await getAdminStatus();
  if (!user) return { error: json({ error: "Sign in to open this thread." }, 401) as Response };

  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("id, status").eq("id", id).maybeSingle();
  if (error || !data) return { error: json({ error: "Order not found." }, 404) as Response };

  return { user, isAdmin, order: data as { id: string; status: OrderStatus } };
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await loadOrder(id);
  if ("error" in access) return access.error;

  try {
    const since = new URL(request.url).searchParams.get("since");
    return json({ messages: await listOrderMessagesSince(access.order.id, since) });
  } catch (e) {
    if (isMissingOrderMessagesError(e)) return json({ error: MISSING_TABLE }, 503);
    return json({ error: "The thread could not be loaded." }, 500);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await loadOrder(id);
  if ("error" in access) return access.error;
  const { user, isAdmin, order } = access;

  if (!isOrderChatOpen(order.status)) return json({ error: CLOSED_THREAD_MESSAGE }, 409);

  let body: { message?: unknown };
  try {
    body = (await request.json()) as { message?: unknown };
  } catch {
    return json({ error: "Write a message first." }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Write a message first." }, 400);
  if (message.length > MAX_ORDER_MESSAGE_LENGTH) return json({ error: `Messages are limited to ${MAX_ORDER_MESSAGE_LENGTH} characters.` }, 400);

  const viewer = isAdmin ? "admin" : "customer";

  try {
    // Turn rule: the customer waits until an admin replied. The admin never waits.
    if (viewer === "customer") {
      const turn = orderChatTurn(await listOrderMessagesSince(order.id, null), "customer");
      if (!turn.canSend) return json({ error: turn.note }, 409);
    }

    const saved = await insertOrderMessage({
      orderId: order.id,
      senderType: viewer,
      senderId: user.id,
      senderName: user.name ?? user.email ?? null,
      senderAvatarUrl: user.avatarUrl ?? null,
      message,
    });

    publishOrderChat(order.id, saved);
    return json({ message: saved }, 201);
  } catch (e) {
    if (isMissingOrderMessagesError(e)) return json({ error: MISSING_TABLE }, 503);
    return json({ error: "The message could not be sent. Please try again." }, 500);
  }
}
