"use client";

import { useState } from "react";
import { PackageSearchIcon } from "lucide-react";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProductCard } from "./product-card";

const ALL = "all";

/**
 * Home page "filtered products" section (UI → Home page): the shop's category pills with
 * the matching products. Every active product is already on the page, so switching a pill
 * filters in the browser – instant, no navigation, the page keeps its scroll position.
 */
export function HomeProductFilter({ categories, products, manageStock }: { categories: Category[]; products: Product[]; manageStock: boolean }) {
  const [active, setActive] = useState<string>(ALL);
  const current = active === ALL ? null : categories.find((c) => c.slug === active) ?? null;
  const shown = current ? products.filter((p) => p.category?.slug === current.slug || p.category_id === current.id) : products;

  return (
    <div className="space-y-6" data-testid="home-product-filter">
      <ToggleGroup
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([active])}
        onSelectionChange={(keys) => {
          const [key] = Array.from(keys);
          if (key != null) setActive(String(key));
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
        {shown.length} {shown.length === 1 ? "product" : "products"}
        {current ? ` in ${current.name}` : ""}
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((product) => (
            <ProductCard key={product.id} product={product} manageStock={manageStock} />
          ))}
        </div>
      )}
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
