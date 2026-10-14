import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * It reads the auth session from cookies, so any Server Component that calls
 * it must be rendered inside a <Suspense> boundary (Cache Components is on).
 * `connection()` additionally tells Next.js that everything after this point
 * is strictly per-request (supabase-js checks token expiry with `Date.now()`,
 * which is not allowed while prerendering).
 */
export async function createClient() {
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component – cookies can't be written there.
            // Safe to ignore because `src/proxy.ts` refreshes sessions.
          }
        },
      },
    },
  );
}
