import { getAdminStatus } from "@/lib/admin/auth";
import { listNotifications, getNotificationPreview, NOTIFICATION_COLUMNS } from "@/lib/notifications.server";
import { NOTIFICATIONS_PER_PAGE, isNotificationFilter } from "@/lib/notifications";

/**
 * GET /api/notifications
 *
 *   ?preview=1&limit=8   → { items, unread }        the bell's popover (re-fetch)
 *   ?filter=all|unread|orders|messages&page=2&per=12 → one page of the list
 *
 * Session-scoped: the query runs with the caller's cookies, so RLS returns their own
 * rows only. The notifications page itself is server-rendered; this endpoint exists for
 * the live popover and for anything that needs to re-read after a mutation.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const { user } = await getAdminStatus();
  if (!user) return json({ error: "Sign in to see your notifications." }, 401);

  const params = new URL(request.url).searchParams;

  if (params.get("preview")) {
    const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 8));
    const { items, unread } = await getNotificationPreview(limit);
    return json({ items, unread, columns: NOTIFICATION_COLUMNS.length });
  }

  const filter = isNotificationFilter(params.get("filter")) ? (params.get("filter") as never) : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const per = Math.min(50, Math.max(5, Number(params.get("per")) || NOTIFICATIONS_PER_PAGE));
  const data = await listNotifications({ filter, page, perPage: per });
  return json(data);
}
