"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NOTIFICATION_MEMORY_SIZE, type AppNotification } from "@/lib/notifications";
import {
  deleteNotifications,
  getActiveOrderChatIds,
  isOrderChatActivelyViewed,
  markAllNotificationsRead,
  markNotificationsRead,
  subscribeActiveOrderChat,
} from "./mutations";
import { mergeNotification, subscribeNotificationStream } from "./notification-stream";

/**
 * The live notification state of one signed-in tab.
 *
 * The **connection** is shared (see `notification-stream.ts` – one EventSource per tab,
 * however often the header island re-mounts); this provider only holds the rendered
 * state and the actions. Both shells mount one: the storefront through the header's bell
 * island, the dashboard through `AdminHeader`'s `bell` slot. It renders nothing itself.
 */

export type NotificationSnapshot = { items: AppNotification[]; unread: number };

type NotificationContextValue = NotificationSnapshot & {
  /** The SSE connection is up. */
  live: boolean;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

/** `null` outside a provider – e.g. the storefront header for a signed-out visitor. */
export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationsProvider({ initial, children }: { initial: NotificationSnapshot; children: ReactNode }) {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [live, setLive] = useState(false);
  const itemsRef = useRef<AppNotification[]>(initial.items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // A new server render (router.refresh, a navigation that re-renders the header) is the
  // freshest truth – adopt it instead of keeping a stale local copy.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setItems(initial.items);
    setUnread(initial.unread);
  }
  /** Ids a request is already changing, so a double click cannot post twice. */
  const inFlight = useRef(new Set<string>());

  /** Silently mark specific notification IDs read when the user is actively in that order's chat. */
  const autoMarkIdsRead = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => !inFlight.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) inFlight.current.add(id);
    void markNotificationsRead(fresh, false)
      .then((result) => {
        if (result && typeof result.unread === "number") {
          setUnread(result.unread);
        }
      })
      .finally(() => {
        for (const id of fresh) inFlight.current.delete(id);
      });
  }, []);

  /**
   * Filters a snapshot of notifications so any unread `order_message` belonging to an
   * order chat that is currently open and visible in this tab is immediately marked read
   * without incrementing the unread badge. Notifications from other orders or other kinds
   * are untouched.
   */
  const reconcileActiveChatItems = useCallback(
    (rawItems: AppNotification[], rawUnread: number): { nextItems: AppNotification[]; nextUnread: number } => {
      const at = new Date().toISOString();
      const idsToMark: string[] = [];

      const nextItems = rawItems.map((n) => {
        if (n.kind === "order_message" && !n.read_at && isOrderChatActivelyViewed(n.order_id)) {
          idsToMark.push(n.id);
          return { ...n, read_at: at };
        }
        return n;
      });

      if (idsToMark.length > 0) {
        autoMarkIdsRead(idsToMark);
      }

      return {
        nextItems,
        nextUnread: Math.max(0, rawUnread - idsToMark.length),
      };
    },
    [autoMarkIdsRead],
  );

  const sweepActiveChatNotifications = useCallback(() => {
    const activeIds = getActiveOrderChatIds();
    if (activeIds.size === 0) return;
    const current = itemsRef.current;
    const idsToMark = current
      .filter((n) => n.kind === "order_message" && !n.read_at && isOrderChatActivelyViewed(n.order_id))
      .map((n) => n.id);
    if (idsToMark.length === 0) return;

    const at = new Date().toISOString();
    const idSet = new Set(idsToMark);
    setItems((prev) => prev.map((n) => (idSet.has(n.id) && !n.read_at ? { ...n, read_at: at } : n)));
    setUnread((prev) => Math.max(0, prev - idsToMark.length));
    autoMarkIdsRead(idsToMark);
  }, [autoMarkIdsRead]);

  // Run once on mount / initial seed change (in case OrderChat mounted first in the tree)
  // and whenever an OrderChat mounts or becomes visible.
  useEffect(() => {
    sweepActiveChatNotifications();
    return subscribeActiveOrderChat(() => {
      sweepActiveChatNotifications();
    });
  }, [sweepActiveChatNotifications, seed]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/notifications?preview=1&limit=${NOTIFICATION_MEMORY_SIZE}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as NotificationSnapshot;
      const { nextItems, nextUnread } = reconcileActiveChatItems(data.items, data.unread);
      setItems(nextItems);
      setUnread(nextUnread);
    } catch {
      // keep what we have – the next frame or focus will catch up
    }
  }, [reconcileActiveChatItems]);

  useEffect(() => {
    // A new row shows up immediately; the badge count is re-read from the server a beat
    // later instead of being guessed locally – one row can never be counted twice, and
    // rows marked read in another tab are included in the same number.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void refresh(), 250);
    };

    const unsubscribe = subscribeNotificationStream((event) => {
      if (event.type === "snapshot") {
        const { nextItems, nextUnread } = reconcileActiveChatItems(event.items, event.unread);
        setItems(nextItems);
        setUnread(nextUnread);
        setLive(true);
      } else if (event.type === "notification") {
        const incoming = event.notification;
        if (incoming.kind === "order_message" && !incoming.read_at && isOrderChatActivelyViewed(incoming.order_id)) {
          const at = new Date().toISOString();
          setItems((prev) => mergeNotification(prev, { ...incoming, read_at: at }));
          autoMarkIdsRead([incoming.id]);
          return;
        }
        setItems((prev) => mergeNotification(prev, incoming));
        settle();
      } else if (event.type === "unread") {
        if (inFlight.current.size === 0) {
          setUnread(event.unread);
        }
        setLive(true);
      } else if (event.type === "live") {
        setLive(event.live);
      } else {
        void refresh();
      }
    });

    return () => {
      if (pending) clearTimeout(pending);
      unsubscribe();
    };
  }, [refresh, reconcileActiveChatItems, autoMarkIdsRead]);

  // A background tab may miss a frame or two; coming back re-reads the truth once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const markRead = useCallback(
    async (ids: string[]) => {
      const fresh = ids.filter((id) => !inFlight.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) inFlight.current.add(id);
      const at = new Date().toISOString();
      setItems((prev) => prev.map((n) => (fresh.includes(n.id) && !n.read_at ? { ...n, read_at: at } : n)));
      const result = await markNotificationsRead(fresh);
      for (const id of fresh) inFlight.current.delete(id);
      if (result?.unread !== undefined) setUnread(result.unread);
      else {
        toast.error("The notification could not be marked read.");
        void refresh();
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    const at = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: at })));
    setUnread(0);
    const result = await markAllNotificationsRead();
    if (result?.unread !== undefined) setUnread(result.unread);
    else {
      toast.error("The notifications could not be marked read.");
      void refresh();
    }
    router.refresh();
  }, [refresh, router]);

  const remove = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setItems((prev) => prev.filter((n) => !ids.includes(n.id)));
      const result = await deleteNotifications(ids);
      if (result?.unread !== undefined) setUnread(result.unread);
      else {
        toast.error("The notifications could not be deleted.");
        void refresh();
      }
      router.refresh();
    },
    [refresh, router],
  );

  return <NotificationContext.Provider value={{ items, unread, live, markRead, markAllRead, remove, refresh }}>{children}</NotificationContext.Provider>;
}
