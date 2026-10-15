import { pageCount, paginationItems } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type Props = {
  page: number;
  total: number;
  perPage: number;
  /** Server-rendered lists (/shop): every page is a real link, shareable and crawlable. */
  hrefFor?: (page: number) => string;
  /** Client-side lists (home-page filter): the page changes in place. */
  onPageChange?: (page: number) => void;
  className?: string;
};

/**
 * Storefront pager under a product grid: Previous · 1 … 4 [5] 6 … 12 · Next. Renders nothing
 * while everything fits on one page. Numbers are shown from `sm` up; phones get a compact
 * "Page 2 of 5" between the arrows so the row never overflows.
 */
export function ProductPagination({ page, total, perPage, hrefFor, onPageChange, className }: Props) {
  const pages = pageCount(total, perPage);
  if (pages <= 1) return null;

  const linkProps = (target: number) =>
    hrefFor ? { href: hrefFor(target) } : { onPress: () => onPageChange?.(target) };

  return (
    <Pagination aria-label="Product pages" className={cn("mt-8", className)}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious {...(page > 1 ? linkProps(page - 1) : {})} isDisabled={page <= 1} aria-label="Previous page" />
        </PaginationItem>
        <PaginationItem className="px-2 text-sm text-muted-foreground tabular-nums sm:hidden">
          Page {page} of {pages}
        </PaginationItem>
        {paginationItems(page, pages).map((item, i) =>
          item === "…" ? (
            <PaginationItem key={`gap-${i}`} className="hidden sm:block">
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item} className="hidden sm:block">
              <PaginationLink {...linkProps(item)} isActive={item === page} aria-label={`Page ${item}`}>
                {item}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext {...(page < pages ? linkProps(page + 1) : {})} isDisabled={page >= pages} aria-label="Next page" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
