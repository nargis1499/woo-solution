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
    // e-mail sign-ups set `full_name`; Google adds `name`, `avatar_url`, `picture`
    user_metadata?: { full_name?: string; name?: string; avatar_url?: string; picture?: string };
  };
  const meta = claims.user_metadata ?? {};

  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: meta.full_name ?? meta.name ?? null,
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
}
