/**
 * Storefront catalogue paging, shared by /shop (server-rendered, `?page=` links) and the
 * home-page product filter (client-side). No server-only imports.
 */

/** Products per page on /shop and in the home-page filter; a pager appears past this many. */
export const PRODUCTS_PER_PAGE = 12;

export type ShopParams = { category?: string | null; q?: string | null; page?: number | null };

/**
 * `/shop?category=…&q=…&page=…` – empties and page 1 are dropped, so every page has exactly
 * one URL (shareable, and the canonical one is easy to derive).
 */
export function shopHref({ category, q, page }: ShopParams = {}): string {
  const sp = new URLSearchParams();
  if (category) sp.set("category", category);
  if (q) sp.set("q", q);
  if (page && page > 1) sp.set("page", String(page));
  const query = sp.toString();
  return query ? `/shop?${query}` : "/shop";
}

/** "23 products in Electronics matching “usb” — showing 13–23" (range only when paginated). */
export function productCountLabel({ total, categoryName, q, first, last }: { total: number; categoryName?: string | null; q?: string | null; first?: number; last?: number }): string {
  let label = `${total} ${total === 1 ? "product" : "products"}`;
  if (categoryName) label += ` in ${categoryName}`;
  if (q) label += ` matching “${q}”`;
  if (first && last && (first > 1 || last < total)) label += ` — showing ${first}–${last}`;
  return label;
}
