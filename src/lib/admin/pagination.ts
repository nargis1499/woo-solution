/**
 * Pagination helpers shared by server components, server actions and the
 * client-side "per page" select (no `server-only` import on purpose).
 *
 * URL contract for a paginated admin list:
 *   ?page=3        1-based page, omitted on page 1
 *   ?per=50        page size, one of PER_PAGE_OPTIONS. Every generated list
 *                  link carries it explicitly so a URL always means the same
 *                  page; only a bare URL (sidebar link) falls back to the
 *                  admin's remembered preference (PER_PAGE_COOKIE), then 10.
 * Everything else (q, category, …) is carried along untouched.
 */

export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_PER_PAGE: (typeof PER_PAGE_OPTIONS)[number] = 10;
export const PER_PAGE_COOKIE = "admin_per_page";

type ListParams = Record<string, string | number | undefined | null> & { page?: number; per?: number };

/** Validated page size; anything unexpected falls back to `fallback`. */
export function parsePerPage(value: unknown, fallback: number = DEFAULT_PER_PAGE): number {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return (PER_PAGE_OPTIONS as readonly number[]).includes(n) ? n : fallback;
}

/** Validated 1-based page number (≥ 1). */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" || typeof value === "number" ? Math.floor(Number(value)) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Number of pages for `total` rows – always at least 1 so page 1 exists for an empty list. */
export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / perPage));
}

/**
 * The page that keeps the first currently visible row in view after the page
 * size changes (page 3 of 10/page → rows 21–30 → page 1 of 50/page; page 2 of
 * 50/page → row 51 → page 6 of 10/page). Keeps pagination and page size in sync.
 */
export function pageForNewSize(page: number, perPage: number, nextPerPage: number): number {
  const firstIndex = (Math.max(1, page) - 1) * perPage;
  return Math.floor(firstIndex / nextPerPage) + 1;
}

/** Builds `pathname?…` from list params, dropping empties and page 1 (`per` is always kept). */
export function listHref(pathname: string, params: ListParams = {}): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || key === "per" || value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  if (params.per) sp.set("per", String(params.per));
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const query = sp.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Items for a numbered pager: 1 … 4 [5] 6 … 12 (`"…"` marks a gap). */
export function paginationItems(page: number, pages: number, siblings = 1): (number | "…")[] {
  const windowSize = siblings * 2 + 5; // first, last, current ± siblings, two gaps
  if (pages <= windowSize) return Array.from({ length: pages }, (_, i) => i + 1);

  const left = Math.max(2, Math.min(page - siblings, pages - siblings * 2 - 2));
  const right = Math.min(pages - 1, Math.max(page + siblings, siblings * 2 + 3));
  const items: (number | "…")[] = [1];
  if (left > 2) items.push("…");
  for (let i = left; i <= right; i++) items.push(i);
  if (right < pages - 1) items.push("…");
  items.push(pages);
  return items;
}

/**
 * Accepts a "go back to this list" path only when it points at the given admin
 * list (same-app, relative, no `//host`), and strips stale flash params.
 * Used for `?from=` on edit pages and the `return_to` field of actions.
 */
export function safeListReturn(raw: unknown, listPath: string): string | null {
  if (typeof raw !== "string" || !raw.startsWith(listPath) || raw.startsWith("//")) return null;
  if (!/^[\w\-./?=&%+]*$/.test(raw)) return null;
  const url = new URL(raw, "http://admin.local");
  if (url.pathname !== listPath) return null;
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  const query = url.searchParams.toString();
  return query ? `${listPath}?${query}` : listPath;
}
