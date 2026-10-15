import type { ReactNode } from "react";
import { listHref, pageCount, paginationItems } from "@/lib/admin/pagination";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { PerPageSelect } from "./per-page-select";

type ListLocation = {
  /** List route, e.g. `/nemesis/products`. */
  pathname: string;
  /** Filter params to carry along (q, category, status …). */
  params?: Record<string, string | undefined>;
  page: number;
  perPage: number;
};

/**
 * Row above an admin table: the filter form on the left, the "per page"
 * selector on the right (wraps underneath on narrow screens).
 */
export function ListToolbar({ children, pathname, params = {}, page, perPage }: ListLocation & { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3" data-testid="list-toolbar">
      <div className="min-w-0">{children}</div>
      <PerPageSelect pathname={pathname} params={params} page={page} perPage={perPage} />
    </div>
  );
}

/**
 * Summary + pager under an admin table. Page links are plain hrefs (work
 * without JS, shareable); everything is derived from the URL the server
 * resolved, so the summary, the highlighted page and the rows always agree.
 */
export function Pagination({ pathname, params = {}, page, perPage, total, itemLabel = "items" }: ListLocation & { total: number; itemLabel?: string }) {
  if (total === 0) return null;
  const pages = pageCount(total, perPage);
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  const href = (p: number) => listHref(pathname, { ...params, per: perPage, page: p });

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="pagination">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing{" "}
        <span className="font-semibold text-foreground">
          {first}–{last}
        </span>{" "}
        of <span className="font-semibold text-foreground">{total}</span> {itemLabel}
      </p>
      {pages > 1 && (
        <PaginationRoot className="mx-0 w-auto justify-end" aria-label="Pagination">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href={page > 1 ? href(page - 1) : undefined} isDisabled={page <= 1} aria-label="Previous page" />
            </PaginationItem>
            {paginationItems(page, pages).map((item, i) =>
              item === "…" ? (
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink href={href(item)} isActive={item === page} aria-label={`Page ${item}`}>
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext href={page < pages ? href(page + 1) : undefined} isDisabled={page >= pages} aria-label="Next page" />
            </PaginationItem>
          </PaginationContent>
        </PaginationRoot>
      )}
    </div>
  );
}
