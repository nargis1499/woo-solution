/**
 * Notification rules shared by the bell, the notifications page, the API routes and the
 * SSE stream. Pure constants and helpers – no `server-only` import here.
 *
 * The rows themselves are written by triggers (see
 * supabase/migrations/20261034000000_notifications.sql); `href` is stored with the row,
 * so one component can render a customer's bell and an admin's bell alike.
 */

export const NOTIFICATION_KINDS = ["new_order", "order_status", "order_cancelled", "payment", "order_message"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationCategory = "orders" | "messages";

/** Which tab a notification belongs to. */
export function notificationCategory(kind: NotificationKind): NotificationCategory {
  return kind === "order_message" ? "messages" : "orders";
}

/** The filter tabs of the notifications page (and of `?tab=`). */
export const NOTIFICATION_FILTERS = ["all", "unread", "orders", "messages"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const NOTIFICATION_FILTER_LABELS: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
  orders: "Orders",
  messages: "Messages",
};

export function isNotificationFilter(value: unknown): value is NotificationFilter {
  return typeof value === "string" && (NOTIFICATION_FILTERS as readonly string[]).includes(value);
}

/** One row of `public.notifications` as both sides render it. */
export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** `/orders/<id>` for a customer, `/nemesis/orders/<id>` for an admin. */
  href: string;
  order_id: string | null;
  actor_name: string | null;
  read_at: string | null;
  created_at: string;
};

/** Page size of the notifications page (the bell shows a short preview). */
export const NOTIFICATIONS_PER_PAGE = 12;
/** How many raw rows the bell's popover fetches before grouping by order. */
export const NOTIFICATION_PREVIEW_SIZE = 25;
/** How many the open tab keeps in memory between two server renders. */
export const NOTIFICATION_MEMORY_SIZE = 40;

export type NotificationGroup = {
  /** Stable React key (`order-msg:<order_id>` or row id). */
  key: string;
  /** The newest notification in the group (drives the header and preview). */
  latest: AppNotification;
  /** All notifications in this group, newest first. */
  items: AppNotification[];
  /** All notification IDs in this group. */
  ids: string[];
  /** Unread notification IDs in this group. */
  unreadIds: string[];
};

/**
 * Aggregates `order_message` notifications that share the same `order_id` (or `href`)
 * into a single grouped entry at the position of the newest message for that order.
 * Non-message notifications stay individual entries.
 */
export function groupNotifications(items: AppNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const messageGroupByOrder = new Map<string, NotificationGroup>();

  for (const item of items) {
    const groupKey = item.kind === "order_message" ? (item.order_id || item.href) : null;
    if (groupKey) {
      const existing = messageGroupByOrder.get(groupKey);
      if (existing) {
        existing.items.push(item);
        existing.ids.push(item.id);
        if (!item.read_at) existing.unreadIds.push(item.id);
        continue;
      }
      const group: NotificationGroup = {
        key: `order-msg:${groupKey}`,
        latest: item,
        items: [item],
        ids: [item.id],
        unreadIds: item.read_at ? [] : [item.id],
      };
      messageGroupByOrder.set(groupKey, group);
      groups.push(group);
    } else {
      groups.push({
        key: item.id,
        latest: item,
        items: [item],
        ids: [item.id],
        unreadIds: item.read_at ? [] : [item.id],
      });
    }
  }

  return groups;
}

/**
 * "5m ago" for the first day, then a short date. Deliberately computed on the client
 * (the server cannot know the reader's clock); `RelativeTime` keeps hydration quiet.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** Short, human label of the event – used as the row's category chip on the page. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  new_order: "New order",
  order_status: "Order update",
  order_cancelled: "Cancelled",
  payment: "Payment",
  order_message: "Message",
};
