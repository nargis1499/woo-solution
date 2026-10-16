import type { OrderMessage } from "@/lib/types";

/**
 * In-process fan-out for the SSE stream (`/api/orders/[id]/chat/stream`).
 *
 * Publish is called by the POST route; every stream subscribed to that order gets the
 * message pushed the moment it is stored. The stream *also* polls the database, so a
 * broadcast this process never saw (a second instance, a restart) still arrives.
 *
 * The map lives on `globalThis` so a dev-server reload keeps the subscribers of streams
 * that are still open.
 */
type Listener = (message: OrderMessage) => void;

const globalRef = globalThis as typeof globalThis & { __orderChatListeners?: Map<string, Set<Listener>> };
const listeners = (globalRef.__orderChatListeners ??= new Map<string, Set<Listener>>());

export function subscribeOrderChat(orderId: string, listener: Listener): () => void {
  let set = listeners.get(orderId);
  if (!set) listeners.set(orderId, (set = new Set()));
  set.add(listener);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(orderId);
  };
}

export function publishOrderChat(orderId: string, message: OrderMessage): void {
  for (const listener of listeners.get(orderId) ?? []) {
    try {
      listener(message);
    } catch {
      // a half-closed stream must never break the person posting
    }
  }
}
