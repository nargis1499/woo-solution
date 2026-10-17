import { getAdminStatus } from "@/lib/admin/auth";
import { deleteNotifications } from "@/lib/notifications.server";
import { publishNotificationsChanged } from "@/lib/notification-bus";

/**
 * POST /api/notifications/delete — `{ ids: string[] }`.
 *
 * RLS scopes the DELETE to the caller's own rows; anything else is a silent no-op.
 * Returns the fresh unread count for the badge.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const { user } = await getAdminStatus();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)) : [];
  if (ids.length === 0) return json({ error: "Select at least one notification." }, 400);

  try {
    const unread = await deleteNotifications(ids);
    publishNotificationsChanged(user.id);
    return json({ ok: true, unread, deleted: ids.length });
  } catch {
    return json({ error: "The notifications could not be deleted." }, 500);
  }
}
