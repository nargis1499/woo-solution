import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * Semantic server-rendered breadcrumb trail (`<nav><ol><li><a href>`), ensuring
 * search engine crawlers always receive real internal links in the initial HTML
 * without waiting on client-side collection hydration.
 */
export function PageBreadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumb" className={cn(className)}>
      <ol
        data-slot="breadcrumb-list"
        className="flex flex-wrap items-center gap-1.5 text-sm wrap-break-word text-muted-foreground sm:gap-2.5"
      >
        {items.map((item, i) => {
          const isCurrent = i === items.length - 1;
          return (
            <li
              key={`${item.label}-${i}`}
              data-slot="breadcrumb-item"
              className="inline-flex items-center gap-1.5"
            >
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  data-slot="breadcrumb-link"
                  className="transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  data-slot="breadcrumb-page"
                  aria-current={isCurrent ? "page" : undefined}
                  className="font-normal text-foreground"
                >
                  {item.label}
                </span>
              )}
              {!isCurrent && (
                <span
                  data-slot="breadcrumb-separator"
                  role="presentation"
                  aria-hidden="true"
                  className="[&>svg]:size-3.5"
                >
                  <ChevronRightIcon />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
