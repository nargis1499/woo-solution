"use client";

/**
 * Client-side notification mutations, callable from anywhere in the tab.
 *
 * The board on the notifications page is *outside* the bell's provider (it lives in a
 * page, the provider in the header island), so both go through these thin wrappers.
 * Every call publishes the fresh unread count on a module-level bus; the provider
 * listens and repaints the badge at once. The database remains the source of truth – a
 * dropped event is healed by the SSE stream's next count check.
 */

type Listener = (unread: number) => void;
type ActiveChatListener = (orderId: string) => void;

const globalRef = globalThis as typeof globalThis & {
  __notificationLocalListeners?: Set<Listener>;
  __activeOrderChatIds?: Set<string>;
  __activeOrderChatListeners?: Set<ActiveChatListener>;
};
const listeners = (globalRef.__notificationLocalListeners ??= new Set<Listener>());
const activeOrderChatIds = (globalRef.__activeOrderChatIds ??= new Set<string>());
const activeChatListeners = (globalRef.__activeOrderChatListeners ??= new Set<ActiveChatListener>());

export function subscribeLocalNotificationChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeActiveOrderChat(listener: ActiveChatListener): () => void {
  activeChatListeners.add(listener);
  return () => activeChatListeners.delete(listener);
}

function emit(unread: number) {
  for (const listener of listeners) {
    try {
      listener(unread);
    } catch {
      // a listener that throws must not break the mutation
    }
  }
}

export function notifyActiveOrderChatViewed(orderId: string) {
  if (!orderId || typeof document === "undefined" || document.visibilityState !== "visible") return;
  for (const listener of activeChatListeners) {
    try {
      listener(orderId);
    } catch {
      // ignore
    }
  }
}

/**
 * Registers an `OrderChat` instance mounted in the current tab.
 * Used so incoming `order_message` notifications for the order being actively viewed
 * (`document.visibilityState === "visible"`) are automatically marked read without
 * flashing the bell counter, while messages from any other order still notify normally.
 */
export function registerActiveOrderChat(orderId: string): () => void {
  activeOrderChatIds.add(orderId);
  notifyActiveOrderChatViewed(orderId);
  return () => {
    activeOrderChatIds.delete(orderId);
  };
}

export function getActiveOrderChatIds(): ReadonlySet<string> {
  return activeOrderChatIds;
}

/**
 * True only when `orderId` has an open `OrderChat` in this tab AND the tab is visible.
 * Background/minimized tabs return `false` so the user still gets an unread badge.
 */
export function isOrderChatActivelyViewed(orderId: string | null | undefined): boolean {
  if (!orderId || !activeOrderChatIds.has(orderId)) return false;
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

async function post(path: string, body: unknown, notifyRefresh = true): Promise<{ unread?: number } | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { unread?: number };
    if (notifyRefresh && typeof data.unread === "number") emit(data.unread);
    return data;
  } catch {
    return null;
  }
}

export function markNotificationsRead(ids: string[], notifyRefresh = true) {
  return ids.length === 0 ? Promise.resolve(null) : post("/api/notifications/read", { ids }, notifyRefresh);
}

export function markAllNotificationsRead() {
  return post("/api/notifications/read", { all: true });
}

export function deleteNotifications(ids: string[]) {
  return ids.length === 0 ? Promise.resolve(null) : post("/api/notifications/delete", { ids });
}
