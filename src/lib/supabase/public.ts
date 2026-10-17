import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-less Supabase client for *public* data that is safe to cache across
 * users (site settings, …). It never reads the request, so it can be used
 * inside `"use cache"` functions and during prerendering.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_placeholder",
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(8000),
          }),
      },
    },
  );
}
