import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client – **server only**, and only for the one thing RLS cannot do:
 * creating an account through Supabase's Admin API. Every caller must have passed
 * `assertAdmin()` first (see `createUser` in `src/app/nemesis/actions.ts`).
 *
 * Returns `null` when the key is not configured, so the action can say what is missing
 * instead of the page failing to render.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
