"use client";

import { useRef, useState } from "react";
import { PackageSearchIcon } from "lucide-react";
import { PRODUCTS_PER_PAGE, productCountLabel } from "@/lib/catalog";
import { pageCount, pageRange } from "@/lib/pagination";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProductCard } from "./product-card";
import { ProductPagination } from "./product-pagination";

const ALL = "all";

/**
 * Home page "filtered products" section (UI → Home page): the shop's category pills with
 * the matching products, PRODUCTS_PER_PAGE at a time. Every active product is already on
 * the page, so switching a pill or a page happens in the browser – instant, no navigation.
 * A pill change keeps the scroll position (the pills stay under the pointer); a page change
 * scrolls back to the top of the section, where the new page starts.
 */
export function HomeProductFilter({ categories, products, manageStock }: { categories: Category[]; products: Product[]; manageStock: boolean }) {
  const [active, setActive] = useState<string>(ALL);
  const [requestedPage, setRequestedPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);

  const current = active === ALL ? null : categories.find((c) => c.slug === active) ?? null;
  const shown = current ? products.filter((p) => p.category?.slug === current.slug || p.category_id === current.id) : products;
  // Clamp instead of resetting in an effect: a server refresh may shrink the list under us.
  const page = Math.min(requestedPage, pageCount(shown.length, PRODUCTS_PER_PAGE));
  const { first, last } = pageRange(page, PRODUCTS_PER_PAGE, shown.length);
  const visible = shown.slice(first - 1, last);

  const goToPage = (next: number) => {
    setRequestedPage(next);
    // Back to the section heading (one level up), clear of the sticky header.
    (top.current?.closest("section") ?? top.current)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div ref={top} className="space-y-6" data-testid="home-product-filter">
      <ToggleGroup
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([active])}
        onSelectionChange={(keys) => {
          const [key] = Array.from(keys);
          if (key == null) return;
          setActive(String(key));
          setRequestedPage(1);
        }}
        aria-label="Filter products by category"
        variant="outline"
        size="sm"
        className="flex-wrap gap-2"
      >
        <Pill id={ALL}>All</Pill>
        {categories.map((c) => (
          <Pill key={c.id} id={c.slug}>
            {c.name}
          </Pill>
        ))}
      </ToggleGroup>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {productCountLabel({ total: shown.length, categoryName: current?.name, first, last })}
      </p>

      {shown.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>{current ? "No products in this category yet." : "No products yet."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} manageStock={manageStock} />
          ))}
        </div>
      )}

      <ProductPagination page={page} total={shown.length} perPage={PRODUCTS_PER_PAGE} onPageChange={goToPage} />
    </div>
  );
}

/** Same look as the pills on /shop (badge-shaped, filled when selected). */
function Pill({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <ToggleGroupItem
      id={id}
      className={cn(
        "h-8 rounded-full border border-border bg-transparent px-4 text-sm font-medium shadow-none",
        "hover:bg-accent hover:text-accent-foreground",
        "data-selected:border-primary data-selected:bg-primary data-selected:text-primary-foreground data-selected:hover:bg-primary/90",
      )}
    >
      {children}
    </ToggleGroupItem>
  );
}
