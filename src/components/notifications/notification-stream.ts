"use client";

import { NOTIFICATION_MEMORY_SIZE, type AppNotification } from "@/lib/notifications";
import { subscribeLocalNotificationChanges } from "./mutations";

/**
 * The tab's **one** live connection.
 *
 * A React effect per component is not enough here: a client-side navigation re-mounts the
 * header island, and a second, older EventSource would keep running next to the new one –
 * two streams delivering the same `notification` frame, so the badge counted twice.
 * This module owns exactly one connection and hands the same events to every subscriber;
 * it is opened when the first component subscribes and closed when the last one leaves
 * (which is also what sign-out does).
 *
 * Delivery is still Server-Sent Events: one `GET /api/notifications/stream` per tab.
 */

export type StreamEvent =
  | { type: "snapshot"; items: AppNotification[]; unread: number }
  | { type: "notification"; notification: AppNotification }
  | { type: "unread"; unread: number }
  | { type: "refresh" }
  | { type: "live"; live: boolean };

type Listener = (event: StreamEvent) => void;

const globalRef = globalThis as typeof globalThis & {
  __notificationStream?: { source: EventSource | null; listeners: Set<Listener>; unsubscribeLocal: (() => void) | null; ids: Set<string> };
};

const connection = (globalRef.__notificationStream ??= { source: null, listeners: new Set(), unsubscribeLocal: null, ids: new Set() });

function open() {
  // One socket per tab, whatever happens above: a stale connection that was never closed
  // (a tree the router kept alive) goes first, so no frame can be delivered twice.
  if (connection.source) {
    connection.source.close();
    connection.source = null;
  }
  const source = new EventSource("/api/notifications/stream");
  connection.source = source;

  const emit = (event: StreamEvent) => {
    for (const listener of connection.listeners) {
      try {
        listener(event);
      } catch {
        // one broken subscriber must not stop the others
      }
    }
  };

  source.addEventListener("open", () => emit({ type: "live", live: true }));

  source.addEventListener("snapshot", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { items: AppNotification[]; unread: number };
      connection.ids = new Set(data.items.map((item) => item.id));
      emit({ type: "snapshot", items: data.items, unread: data.unread });
    } catch {
      // ignore a malformed frame
    }
  });

  source.addEventListener("notification", (event) => {
    let notification: AppNotification;
    try {
      notification = JSON.parse((event as MessageEvent<string>).data) as AppNotification;
    } catch {
      return;
    }
    // The same row can arrive twice (a reconnect replays what the snapshot already held):
    // an id is announced once, so no listener ever counts a notification twice.
    if (connection.ids.has(notification.id)) return;
    connection.ids.add(notification.id);
    emit({ type: "notification", notification });
  });

  source.addEventListener("unread", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { unread: number };
      if (typeof data.unread === "number") emit({ type: "unread", unread: data.unread });
    } catch {
      // ignore
    }
  });

  source.addEventListener("refresh", () => emit({ type: "refresh" }));
  source.addEventListener("error", () => emit({ type: "live", live: false }));
}

function close() {
  connection.source?.close();
  connection.source = null;
  connection.unsubscribeLocal?.();
  connection.unsubscribeLocal = null;
}

/** Subscribe to the shared stream; the first subscriber opens the connection. */
export function subscribeNotificationStream(listener: Listener): () => void {
  connection.listeners.add(listener);
  if (connection.listeners.size === 1) {
    open();
    // the notifications page mutates rows through `mutations.ts` → re-read once for everyone
    connection.unsubscribeLocal = subscribeLocalNotificationChanges(() => {
      for (const l of connection.listeners) l({ type: "refresh" });
    });
  }

  return () => {
    connection.listeners.delete(listener);
    if (connection.listeners.size === 0) close();
  };
}

/** Where a notification would sort: newest first, id as the tie-break (same server order). */
export function mergeNotification(items: AppNotification[], incoming: AppNotification): AppNotification[] {
  if (items.some((item) => item.id === incoming.id)) return items;
  const next = [incoming, ...items];
  next.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  return next.slice(0, NOTIFICATION_MEMORY_SIZE);
}
