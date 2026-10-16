import { getCurrentUser } from "@/lib/auth";
import { PresenceHeartbeat } from "./presence-heartbeat";

/**
 * Server wrapper for the storefront header: only signed-in visitors are tracked
 * (their own profile row is the one being stamped). Renders inside the header's
 * existing <Suspense>, so reading the session cookie costs no extra round trip –
 * `getCurrentUser()` shares the request-scoped cache with the account menu.
 */
export async function PresenceGate() {
  const user = await getCurrentUser();
  return user ? <PresenceHeartbeat /> : null;
}
