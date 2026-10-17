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

const globalRef = globalThis as typeof globalThis & { __notificationLocalListeners?: Set<Listener> };
const listeners = (globalRef.__notificationLocalListeners ??= new Set<Listener>());

export function subscribeLocalNotificationChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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

async function post(path: string, body: unknown): Promise<{ unread?: number } | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { unread?: number };
    if (typeof data.unread === "number") emit(data.unread);
    return data;
  } catch {
    return null;
  }
}

export function markNotificationsRead(ids: string[]) {
  return ids.length === 0 ? Promise.resolve(null) : post("/api/notifications/read", { ids });
}

export function markAllNotificationsRead() {
  return post("/api/notifications/read", { all: true });
}

export function deleteNotifications(ids: string[]) {
  return ids.length === 0 ? Promise.resolve(null) : post("/api/notifications/delete", { ids });
}
