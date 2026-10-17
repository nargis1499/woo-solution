import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = ["/checkout", "/orders", "/account", "/notifications", "/nemesis"];
/** Routes that signed-in users should not see again. */
const AUTH_ONLY_PREFIXES = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getClaims().
  // getClaims() verifies the JWT and refreshes the session when needed.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, supabaseResponse);
  }

  if (user && AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    const next = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}

/** Redirect while preserving any refreshed auth cookies / cache headers. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const response = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) response.headers.set(header, value);
  }
  return response;
}
