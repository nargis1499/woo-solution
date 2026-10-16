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

/** Oldest → newest, with a stable order for messages written in the same millisecond. */
export function sortOrderMessages<T extends Pick<OrderMessage, "created_at" | "id">>(messages: T[]): T[] {
  return [...messages].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
}
