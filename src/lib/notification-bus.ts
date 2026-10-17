/**
 * In-process fan-out for `/api/notifications/stream`.
 *
 * New notifications are written by **database triggers**, so the stream finds them by
 * reading the table (a cheap `created_at > cursor` query on an index) – that is what
 * makes a notification from a second server instance or a SQL fix arrive as well.
 *
 * The bus is for the changes the app itself makes: marking rows read or deleting them
 * in one tab nudges every other open stream of the same user immediately, instead of
 * waiting for its next read.
 *
 * The map lives on `globalThis` so a dev-server reload keeps the streams that are open.
 */

type Listener = () => void;

const globalRef = globalThis as typeof globalThis & { __notificationListeners?: Map<string, Set<Listener>> };
const listeners = (globalRef.__notificationListeners ??= new Map<string, Set<Listener>>());

export function subscribeNotifications(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(listener);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(userId);
  };
}

/** "Something about this user's notifications changed" – the stream re-reads. */
export function publishNotificationsChanged(userId: string): void {
  for (const listener of listeners.get(userId) ?? []) {
    try {
      listener();
    } catch {
      // a half-closed stream must never break the request that changed the row
    }
  }
}
