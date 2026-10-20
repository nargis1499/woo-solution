import { getAdminStatus } from "@/lib/admin/auth";
import { markNotificationsRead, markOrderMessageNotificationsRead } from "@/lib/notifications.server";
import { publishNotificationsChanged } from "@/lib/notification-bus";

/**
 * POST /api/notifications/read — `{ ids: string[] }`, `{ all: true }`, or `{ orderId: string }`.
 *
 * The caller only ever sends ids / orderId: the row's recipient is enforced by RLS, so a
 * forged id simply matches nothing. Returns the fresh unread count for the badge.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const { user } = await getAdminStatus();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: { ids?: unknown; all?: unknown; orderId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const orderId = typeof body.orderId === "string" && UUID_RE.test(body.orderId) ? body.orderId : null;
  if (orderId) {
    try {
      const unread = await markOrderMessageNotificationsRead(orderId);
      publishNotificationsChanged(user.id);
      return json({ ok: true, unread });
    } catch {
      return json({ error: "The notifications could not be updated." }, 500);
    }
  }

  const all = body.all === true;
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)) : [];
  if (!all && ids.length === 0) return json({ ok: true, unread: await markNotificationsRead([]) });

  try {
    const unread = await markNotificationsRead(all ? "all" : ids);
    publishNotificationsChanged(user.id);
    return json({ ok: true, unread });
  } catch {
    return json({ error: "The notifications could not be updated." }, 500);
  }
}
