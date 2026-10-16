import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/presence/ping — the heartbeat behind "Online" / "Last seen …".
 *
 * Stamps `profiles.last_active_at = now()` for the signed-in user (the request's own
 * client + the "own profile" RLS policy, so nothing else can be touched). Being online
 * is *derived* from that stamp – 45 seconds – instead of a stored flag that would go
 * stale the moment a tab closes.
 *
 * 201 when stamped, 204 when the row is missing, 401 for anonymous visitors (the
 * client stops pinging after that).
 */
export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return Response.json({ error: "Sign in to be shown as online." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", data.claims.sub);

  if (updateError) {
    // A database without migration 18 simply has nothing to stamp – stay quiet.
    if (/last_active_at|schema cache|Could not find/i.test(`${updateError.message} ${updateError.details ?? ""}`)) {
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "The heartbeat could not be saved." }, { status: 500, headers: { "cache-control": "no-store" } });
  }

  return Response.json({ ok: true, lastActiveAt: new Date().toISOString() }, { status: 201, headers: { "cache-control": "no-store" } });
}
