import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NOTIFICATIONS_PER_PAGE, type AppNotification, type NotificationFilter } from "@/lib/notifications";
import { pageCount } from "@/lib/pagination";

/**
 * Reads and writes of `public.notifications` (migration 21).
 *
 * Every query runs through the request's own Supabase client, so RLS decides the scope:
 * a recipient sees and edits their own rows and nothing else – the API routes only ever
 * pass ids, never a recipient.
 */

export const NOTIFICATION_COLUMNS = "id, kind, title, body, href, order_id, actor_name, read_at, created_at";

export type NotificationPage = {
  items: AppNotification[];
  total: number;
  page: number;
  pageCount: number;
  unread: number;
};

/** Cache resolved item counts by order_id so SSE ticks never re-query the same order. */
const orderItemCountCache = new Map<string, number>();

/**
 * Replaces stale "· 0 items" in `new_order` notifications (caused by the
 * `after insert on public.orders` trigger running before `order_items` rows are
 * inserted inside `place_order`) with the real total item quantity from `order_items`.
 */
async function enrichNewOrderNotifications(
  items: AppNotification[],
  supabase: SupabaseClient,
): Promise<AppNotification[]> {
  const zeroItemOrders = items.filter(
    (n) => n.kind === "new_order" && Boolean(n.order_id) && /\b0 items\b/i.test(n.body),
  );
  if (zeroItemOrders.length === 0) return items;

  const uncachedOrderIds = [
    ...new Set(
      zeroItemOrders
        .map((n) => n.order_id as string)
        .filter((id) => !orderItemCountCache.has(id)),
    ),
  ];

  if (uncachedOrderIds.length > 0) {
    const { data, error } = await supabase
      .from("order_items")
      .select("order_id, quantity")
      .in("order_id", uncachedOrderIds);

    if (!error && data) {
      const counts = new Map<string, number>();
      for (const row of data as { order_id: string; quantity: number }[]) {
        const qty = Math.max(1, Number(row.quantity) || 1);
        counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + qty);
      }
      for (const id of uncachedOrderIds) {
        orderItemCountCache.set(id, counts.get(id) ?? 0);
      }
    }
  }

  return items.map((n) => {
    if (n.kind !== "new_order" || !n.order_id || !/\b0 items\b/i.test(n.body)) {
      return n;
    }
    const totalQty = orderItemCountCache.get(n.order_id);
    if (!totalQty || totalQty <= 0) return n;
    const itemWord = totalQty === 1 ? "item" : "items";
    return {
      ...n,
      body: n.body.replace(/\b0 items\b/i, `${totalQty} ${itemWord}`),
    };
  });
}

/** True when the error is only "migration 21 has not been run yet". */
export function isMissingNotificationsError(error: unknown): boolean {
  const e = error as { message?: string; code?: string; details?: string } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;
  return /notifications/i.test(text) && /does not exist|schema cache|Could not find/i.test(text);
}

/** The unread badge count. A database without the table simply has none. */
export async function getUnreadNotificationCount(client?: SupabaseClient): Promise<number> {
  const supabase = client ?? (await createClient());
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

/** The newest few – what the bell's popover renders. */
export async function getNotificationPreview(limit = 8, client?: SupabaseClient): Promise<{ items: AppNotification[]; unread: number }> {
  const supabase = client ?? (await createClient());
  const [{ data, error }, unread] = await Promise.all([
    supabase.from("notifications").select(NOTIFICATION_COLUMNS).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit),
    getUnreadNotificationCount(supabase),
  ]);
  if (error) return { items: [], unread: 0 };
  const enriched = await enrichNewOrderNotifications((data ?? []) as AppNotification[], supabase);
  return { items: enriched, unread };
}

/** Everything the header and the notifications page need on first paint. */
export async function getNotificationSummary(): Promise<{ items: AppNotification[]; unread: number }> {
  return getNotificationPreview(8);
}

/** One page of the list, filtered by the tab. */
export async function listNotifications({
  filter = "all",
  page = 1,
  perPage = NOTIFICATIONS_PER_PAGE,
}: {
  filter?: NotificationFilter;
  page?: number;
  perPage?: number;
}): Promise<NotificationPage> {
  const supabase = await createClient();
  const safePage = Math.max(1, Math.floor(page));

  let query = supabase.from("notifications").select(NOTIFICATION_COLUMNS, { count: "exact" });
  if (filter === "unread") query = query.is("read_at", null);
  else if (filter === "orders") query = query.in("kind", ["new_order", "order_status", "order_cancelled", "payment"]);
  else if (filter === "messages") query = query.eq("kind", "order_message");

  const from = (safePage - 1) * perPage;
  const [{ data, count, error }, unread] = await Promise.all([
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + perPage - 1),
    getUnreadNotificationCount(),
  ]);

  if (error) return { items: [], total: 0, page: 1, pageCount: 1, unread };

  const total = count ?? 0;
  const enriched = await enrichNewOrderNotifications((data ?? []) as AppNotification[], supabase);
  return {
    items: enriched,
    total,
    page: safePage,
    pageCount: Math.max(1, pageCount(total, perPage)),
    unread,
  };
}

/** What one SSE tick needs: rows newer than the cursor, oldest first. */
export async function listNotificationsSince(since: string | null, client?: SupabaseClient): Promise<AppNotification[]> {
  const supabase = client ?? (await createClient());
  let query = supabase.from("notifications").select(NOTIFICATION_COLUMNS).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50);
  if (since) query = query.gt("created_at", since);
  const { data, error } = await query;
  if (error) return [];
  return enrichNewOrderNotifications((data ?? []) as AppNotification[], supabase);
}

/** Mark these rows (or every unread one) as read. RLS keeps it to the caller's own rows. */
export async function markNotificationsRead(ids: string[] | "all"): Promise<number> {
  const supabase = await createClient();
  const at = new Date().toISOString();
  let query = supabase.from("notifications").update({ read_at: at }).is("read_at", null);
  if (ids !== "all") {
    if (ids.length === 0) return getUnreadNotificationCount();
    query = query.in("id", ids);
  }
  const { error } = await query;
  if (error && !isMissingNotificationsError(error)) throw error;
  return getUnreadNotificationCount();
}

/**
 * Mark unread `order_message` notifications for a specific `order_id` as read for the
 * signed-in caller. Other orders and non-message notifications on the same order are untouched.
 */
export async function markOrderMessageNotificationsRead(
  orderId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? (await createClient());
  const at = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: at })
    .eq("order_id", orderId)
    .eq("kind", "order_message")
    .is("read_at", null);
  if (error && !isMissingNotificationsError(error)) throw error;
  return getUnreadNotificationCount(supabase);
}

/** Delete the caller's rows. */
export async function deleteNotifications(ids: string[]): Promise<number> {
  if (ids.length === 0) return getUnreadNotificationCount();
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().in("id", ids);
  if (error && !isMissingNotificationsError(error)) throw error;
  return getUnreadNotificationCount();
}
