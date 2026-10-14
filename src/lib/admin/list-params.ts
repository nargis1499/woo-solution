import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PER_PAGE_COOKIE, listHref, parsePage, parsePerPage } from "./pagination";

type RawListParams = { page?: string; per?: string; notice?: string; error?: string };

/**
 * Page number + page size for an admin list request:
 * `?per=` → remembered preference (cookie) → default; `?page=` → 1.
 */
export async function resolveListParams(sp: RawListParams): Promise<{ perPage: number; requestedPage: number }> {
  const cookieStore = await cookies();
  return {
    perPage: parsePerPage(sp.per, parsePerPage(cookieStore.get(PER_PAGE_COOKIE)?.value)),
    requestedPage: parsePage(sp.page),
  };
}

/**
 * Keeps the URL honest. When the data layer had to clamp the requested page
 * (it no longer exists after deletes, a size change or a hand-typed URL) the
 * browser is sent to the page that was actually rendered – any pending
 * `?notice=` / `?error=` toast travels along.
 */
export function redirectIfClamped(
  pathname: string,
  filters: Record<string, string | undefined>,
  sp: RawListParams,
  requestedPage: number,
  page: number,
  perPage: number,
): void {
  if (page === requestedPage) return;
  const flash = sp.notice ? { notice: sp.notice } : sp.error ? { error: sp.error } : {};
  redirect(listHref(pathname, { ...filters, ...flash, per: perPage, page }));
}
