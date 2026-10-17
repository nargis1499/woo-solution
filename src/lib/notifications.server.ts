import "server-only";
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

/** True when the error is only "migration 21 has not been run yet". */
export function isMissingNotificationsError(error: unknown): boolean {
  const e = error as { message?: string; code?: string; details?: string } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;
  return /notifications/i.test(text) && /does not exist|schema cache|Could not find/i.test(text);
}

/** The unread badge count. A database without the table simply has none. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

/** The newest few – what the bell's popover renders. */
export async function getNotificationPreview(limit = 8): Promise<{ items: AppNotification[]; unread: number }> {
  const supabase = await createClient();
  const [{ data, error }, unread] = await Promise.all([
    supabase.from("notifications").select(NOTIFICATION_COLUMNS).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit),
    getUnreadNotificationCount(),
  ]);
  if (error) return { items: [], unread: 0 };
  return { items: (data ?? []) as AppNotification[], unread };
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
  return {
    items: (data ?? []) as AppNotification[],
    total,
    page: safePage,
    pageCount: Math.max(1, pageCount(total, perPage)),
    unread,
  };
}

/** What one SSE tick needs: rows newer than the cursor, oldest first. */
export async function listNotificationsSince(since: string | null): Promise<AppNotification[]> {
  const supabase = await createClient();
  let query = supabase.from("notifications").select(NOTIFICATION_COLUMNS).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50);
  if (since) query = query.gt("created_at", since);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as AppNotification[];
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

/** Delete the caller's rows. */
export async function deleteNotifications(ids: string[]): Promise<number> {
  if (ids.length === 0) return getUnreadNotificationCount();
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().in("id", ids);
  if (error && !isMissingNotificationsError(error)) throw error;
  return getUnreadNotificationCount();
}
