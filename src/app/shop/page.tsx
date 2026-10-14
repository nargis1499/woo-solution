import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getProducts } from "@/lib/data/products";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-grid";
import { SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Shop" };

type SearchParams = Promise<{ category?: string; q?: string }>;

export default function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shop</h1>
          <p className="mt-1 text-neutral-500">Browse our full catalog.</p>
        </div>
        <Suspense fallback={null}>
          <SearchBox searchParams={searchParams} />
        </Suspense>
      </div>

      <Suspense fallback={<ProductGridSkeleton />}>
        <Catalog searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchBox({ searchParams }: { searchParams: SearchParams }) {
  const { q, category } = await searchParams;
  return (
    <form action="/shop" className="relative w-full sm:w-72">
      {category && <input type="hidden" name="category" value={category} />}
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="Search products…"
        className="input-base pl-9"
        aria-label="Search products"
      />
    </form>
  );
}

async function Catalog({ searchParams }: { searchParams: SearchParams }) {
  const { category, q } = await searchParams;
  const [categories, products] = await Promise.all([
    getCategories(),
    getProducts({ categorySlug: category, search: q }),
  ]);

  const active = categories.find((c) => c.slug === category);

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2" aria-label="Categories">
        <CategoryPill href={q ? `/shop?q=${encodeURIComponent(q)}` : "/shop"} active={!category}>
          All
        </CategoryPill>
        {categories.map((c) => (
          <CategoryPill
            key={c.id}
            href={`/shop?category=${c.slug}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            active={c.slug === category}
          >
            {c.name}
          </CategoryPill>
        ))}
      </nav>

      <p className="text-sm text-neutral-500">
        {products.length} {products.length === 1 ? "product" : "products"}
        {active ? ` in ${active.name}` : ""}
        {q ? ` matching “${q}”` : ""}
      </p>

      <ProductGrid
        products={products}
        emptyMessage={q ? `Nothing matches “${q}”. Try a different search.` : "No products in this category yet."}
      />
    </div>
  );
}

function CategoryPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-brand-300 hover:text-brand-700",
      )}
    >
      {children}
    </Link>
  );
}
