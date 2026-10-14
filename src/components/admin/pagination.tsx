import Link from "next/link";
import { cn } from "@/lib/utils";
import { listHref, pageCount, paginationItems } from "@/lib/admin/pagination";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { PerPageSelect } from "./per-page-select";

export type PaginationProps = {
  /** List route, e.g. `/nemesis/products`. */
  pathname: string;
  /** Filter params to carry along (q, category, …). */
  params?: Record<string, string | undefined>;
  page: number;
  perPage: number;
  total: number;
  /** Noun for the summary – "products", "orders"… */
  itemLabel?: string;
};

/**
 * Pager + "per page" control for admin lists. Page links are plain hrefs (so
 * they work without JS and are shareable); the size select lives in a small
 * client component. Summary + controls stay in sync because everything is
 * derived from the URL that the server resolved.
 */
export function Pagination({ pathname, params = {}, page, perPage, total, itemLabel = "items" }: PaginationProps) {
  if (total === 0) return null;
  const pages = pageCount(total, perPage);
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  const href = (p: number) => listHref(pathname, { ...params, per: perPage, page: p });

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="pagination">
      <p className="text-sm text-neutral-600" aria-live="polite">
        Showing <span className="font-semibold text-neutral-900">{first}–{last}</span> of{" "}
        <span className="font-semibold text-neutral-900">{total}</span> {itemLabel}
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <PerPageSelect pathname={pathname} params={params} page={page} perPage={perPage} />

        {pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <PageLink href={page > 1 ? href(page - 1) : undefined} label="Previous page">
              <ChevronLeftIcon className="h-4 w-4" />
            </PageLink>
            {paginationItems(page, pages).map((item, i) =>
              item === "…" ? (
                <span key={`gap-${i}`} className="w-6 text-center text-sm text-neutral-400" aria-hidden>…</span>
              ) : (
                <PageLink key={item} href={href(item)} label={`Page ${item}`} current={item === page}>
                  {item}
                </PageLink>
              ),
            )}
            <PageLink href={page < pages ? href(page + 1) : undefined} label="Next page">
              <ChevronRightIcon className="h-4 w-4" />
            </PageLink>
          </nav>
        )}
      </div>
    </div>
  );
}

function PageLink({ href, label, current, children }: { href?: string; label: string; current?: boolean; children: React.ReactNode }) {
  const base = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium tabular-nums transition-colors";
  if (current) {
    return (
      <span aria-current="page" aria-label={label} className={cn(base, "bg-brand-600 text-white shadow-sm")}>
        {children}
      </span>
    );
  }
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(base, "cursor-not-allowed text-neutral-300")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(base, "border border-neutral-300 bg-surface text-neutral-700 hover:bg-neutral-100")}>
      {children}
    </Link>
  );
}
