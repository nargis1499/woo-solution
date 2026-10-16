import { getAdminStatus } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { publishOrderChat } from "@/lib/order-chat-bus";
import { markOrderMessagesReceived } from "@/lib/order-messages";

/**
 * POST /api/orders/[id]/chat/receipt — read receipts for the inquiry thread.
 *
 * The **recipient** calls this (`{ status: "delivered" | "seen" }`) when the thread is
 * open in their tab: `delivered` the moment a message arrives, `seen` once that tab is
 * visible. Only the other side's messages are stamped (RLS + the sender filter), only
 * if they are not stamped yet, and the sender's open tabs learn about it immediately
 * through the `receipt` event of the SSE stream.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { user, isAdmin } = await getAdminStatus();
  if (!user) return Response.json({ error: "Sign in to open this thread." }, { status: 401, headers: { "cache-control": "no-store" } });

  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("id").eq("id", id).maybeSingle();
  if (!order) return Response.json({ error: "Order not found." }, { status: 404, headers: { "cache-control": "no-store" } });

  let body: { status?: unknown };
  try {
    body = (await request.json()) as { status?: unknown };
  } catch {
    return Response.json({ error: "Missing status." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const status = body.status === "seen" ? "seen" : body.status === "delivered" ? "delivered" : null;
  if (!status) return Response.json({ error: "status must be delivered or seen." }, { status: 400, headers: { "cache-control": "no-store" } });

  try {
    const { ids, at } = await markOrderMessagesReceived(id, isAdmin ? "admin" : "customer", status);
    if (ids.length > 0) publishOrderChat(id, { type: "receipt", ids, status, at });
    return Response.json({ ok: true, ids, at }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The receipt could not be saved." }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
