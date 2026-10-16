import type { OrderMessage, OrderStatus } from "@/lib/types";

/**
 * Shared rules of the order inquiry chat (migration 17). Pure constants and helpers –
 * imported by the API routes (the authority), the React component (the UI) and the pages.
 */

/** Longest message anyone may post; the DB has the same check constraint. */
export const MAX_ORDER_MESSAGE_LENGTH = 200;

/** The thread stays open while an order is pending or cancelled. */
export const ORDER_CHAT_OPEN_STATUSES = ["pending", "cancelled"] as const;

export function isOrderChatOpen(status: OrderStatus): boolean {
  return (ORDER_CHAT_OPEN_STATUSES as readonly string[]).includes(status);
}

export type OrderChatViewer = "customer" | "admin";

export type OrderChatTurn = {
  /** May this viewer post right now (ignoring the length/empty checks)? */
  canSend: boolean;
  /** One line under the composer explaining whose turn it is. */
  note: string;
};

/**
 * Turn rule: a customer holds the pen until they post, then waits for an admin reply;
 * admins can write as many back-to-back messages as they like.
 */
export function orderChatTurn(messages: Pick<OrderMessage, "sender_type">[], viewer: OrderChatViewer): OrderChatTurn {
  if (viewer === "admin") return { canSend: true, note: "Admin can send multiple messages." };
  const last = messages[messages.length - 1];
  if (last && last.sender_type === "customer") {
    return { canSend: false, note: "You can send 1 message. Waiting for Admin response…" };
  }
  return { canSend: true, note: "You can send 1 message. Admin will reply here." };
}

/** The message a rejected post gets, so the client shows the same wording the route returns. */
export const CLOSED_THREAD_MESSAGE = "Inquiries are closed for this order status.";

/** How far one of *your* messages got: ✓ sent, ✓✓ delivered, ✓✓ (green) seen. */
export type MessageReceipt = "sent" | "delivered" | "seen";

/** The stored receipt state of a message. */
export function messageReceipt(message: Pick<OrderMessage, "delivered_at" | "seen_at">): MessageReceipt {
  if (message.seen_at) return "seen";
  if (message.delivered_at) return "delivered";
  return "sent";
}

/** When the admin last wrote in a thread (0 = never). */
export function lastAdminReplyAt(messages: Pick<OrderMessage, "sender_type" | "created_at">[]): number {
  let at = 0;
  for (const message of messages) {
    if (message.sender_type !== "admin") continue;
    const time = Date.parse(message.created_at);
    if (Number.isFinite(time) && time > at) at = time;
  }
  return at;
}

/**
 * The receipt a **customer** is shown for their own message.
 *
 * The stored receipts stay exactly as the recipient stamped them (the admin's own
 * thread shows the real ✓ / ✓✓), but the customer's browser only paints "seen"
 * when the admin let them see it *and* actually answered:
 *
 *  * the admin must be visible as online to this customer (`online` override, or the
 *    global switch when no override exists) — a hidden or offline admin never shows
 *    a read receipt, and
 *  * the admin must have replied after that message — reading is not answering.
 *
 * Everything else degrades to ✓✓ delivered / ✓ sent, never "seen".
 */
export function customerVisibleReceipt(
  message: Pick<OrderMessage, "created_at" | "delivered_at" | "seen_at">,
  { adminOnline, lastAdminReplyAt: replyAt }: { adminOnline: boolean; lastAdminReplyAt: number },
): MessageReceipt {
  const stored = messageReceipt(message);
  if (stored !== "seen") return stored;
  // A stored "seen" always means the message arrived, so a hidden admin degrades to ✓✓.
  if (!adminOnline) return "delivered";
  const sentAt = Date.parse(message.created_at);
  return Number.isFinite(sentAt) && replyAt > sentAt ? "seen" : "delivered";
}

export const MESSAGE_RECEIPT_LABELS: Record<MessageReceipt, string> = {
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
};

/** Oldest → newest, with a stable order for messages written in the same millisecond. */
export function sortOrderMessages<T extends Pick<OrderMessage, "created_at" | "id">>(messages: T[]): T[] {
  return [...messages].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
}
