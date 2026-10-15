/**
 * Pagination arithmetic shared by the storefront (/shop, the home-page filter) and the
 * admin lists. Pure functions, safe to import from server and client code alike.
 */

/** Validated 1-based page number (≥ 1); anything else means page 1. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" || typeof value === "number" ? Math.floor(Number(value)) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Number of pages for `total` rows – always at least 1 so page 1 exists for an empty list. */
export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / perPage));
}

/** 1-based index of the first and last item on `page` ("showing 13–24 of 30"). */
export function pageRange(page: number, perPage: number, total: number): { first: number; last: number } {
  if (total === 0) return { first: 0, last: 0 };
  return { first: (page - 1) * perPage + 1, last: Math.min(total, page * perPage) };
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
