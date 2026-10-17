import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/types";

/**
 * Data-access-layer helper: returns the verified current user (or null).
 * Uses `getClaims()` which validates the JWT signature instead of trusting the
 * cookie payload. Reads cookies → must be used inside a <Suspense> boundary.
 *
 * The display name / avatar come from the **profile row** first and the JWT metadata
 * second: an admin can rename an account from the dashboard (Users → Edit), and that
 * write only touches `profiles`, so a header built from the token alone would keep the
 * name the account was created with. Reading the row keeps the header, the account menu
 * and the dashboard sidebar saying the same thing.
 *
 * Wrapped in `cache()` so the layout, the account menu and the page share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
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

  const { data: profile } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", claims.sub).maybeSingle();

  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: profile?.full_name?.trim() || meta.full_name || meta.name || null,
    avatarUrl: profile?.avatar_url || meta.avatar_url || meta.picture || null,
  };
});
