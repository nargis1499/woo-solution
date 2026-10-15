import { isReservedSlug, PAGE_SLUG_MAX, PAGE_SLUG_RE } from "@/lib/pages/shared";

/*
 * Real 404s for unknown CMS slugs.
 *
 * `/about-us` is served by `app/(store)/[slug]`, which is partially
 * prerendered: the storefront shell is flushed with a 200 before the page data
 * is looked up, so a `notFound()` inside the page can only produce a
 * "soft" 404 (200 + noindex). Search engines and uptime monitors prefer the
 * real thing, so the proxy asks the database first for single-segment paths
 * that can only be a page and rewrites missing ones to the not-found route.
 *
 * Positive answers are remembered for ten seconds per server instance, which
 * keeps the hot path (real pages) to an in-memory lookup; misses always hit
 * the database so a freshly published page is reachable immediately, and a
 * page that was just unpublished is a real 404 within ten seconds (until then
 * the route itself already renders "not found" with a noindex tag).
 * Any failure (no env, timeout, 5xx) falls back to letting the page decide.
 */

const KNOWN_TTL_MS = 10_000;
const known = new Map<string, number>();

/** `"/about-us"` → `"about-us"` when the path can only be a CMS page, otherwise `null`. */
export function pageSlugFromPath(pathname: string): string | null {
  const match = /^\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1];
  if (slug.length > PAGE_SLUG_MAX || !PAGE_SLUG_RE.test(slug) || isReservedSlug(slug)) return null;
  return slug;
}

/** `true` / `false` when the database answered, `null` when it could not be asked. */
export async function publishedPageExists(slug: string): Promise<boolean | null> {
  const now = Date.now();
  const until = known.get(slug);
  if (until !== undefined) {
    if (until > now) return true;
    known.delete(slug);
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return null;

  try {
    // Anonymous read – RLS only exposes published pages to the public role.
    const res = await fetch(`${base.replace(/\/+$/, "")}/rest/v1/pages?select=slug&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    const exists = Array.isArray(rows) && rows.length > 0;
    if (exists) known.set(slug, now + KNOWN_TTL_MS);
    return exists;
  } catch {
    return null;
  }
}
