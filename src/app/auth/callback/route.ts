import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Finishes PKCE auth flows started by Supabase:
 *  - e-mail confirmation links (sign-up)
 *  - OAuth providers (Google)
 * Exchanges the `code` for a session cookie, then redirects to `next`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  // The provider (or Supabase) reported a problem, e.g. "provider is not enabled".
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError && !code) {
    return redirectTo(`/login?error=oauth&message=${encodeURIComponent(providerError)}&next=${encodeURIComponent(next)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
  }

  return redirectTo(`/login?error=auth-code-error&next=${encodeURIComponent(next)}`);
}

/**
 * Relative redirect: the browser resolves it against the host it actually used
 * (localhost, a preview URL, a custom domain …), so the fresh session cookie is
 * always set on the right origin. Avoids `request.url` / `x-forwarded-host`
 * guesswork behind proxies and `next dev --hostname 0.0.0.0`.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
