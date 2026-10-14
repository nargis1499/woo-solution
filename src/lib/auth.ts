import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/types";

/**
 * Data-access-layer helper: returns the verified current user (or null).
 * Uses `getClaims()` which validates the JWT signature instead of trusting the
 * cookie payload. Reads cookies → must be used inside a <Suspense> boundary.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as {
    sub: string;
    email?: string;
    user_metadata?: { full_name?: string; name?: string };
  };

  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? null,
  };
}
