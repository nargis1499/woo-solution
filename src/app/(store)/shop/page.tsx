import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SearchIcon } from "lucide-react";
import { PRODUCTS_PER_PAGE, productCountLabel, shopHref } from "@/lib/catalog";
import { getCategories, getProductPage } from "@/lib/data/products";
import { pageRange, parsePage } from "@/lib/pagination";
import { canonicalFor, robotsFor } from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-grid";
import { ProductPagination } from "@/components/product-pagination";
import { badgeVariants } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type SearchParams = Promise<{ category?: string; q?: string; page?: string }>;

/**
 * Category pages are canonical on their own (they are in the sitemap) and so is every page
 * of a paginated list (self-referencing `?page=`); searches collapse onto /shop and stay
 * out of the index.
 */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { category, q, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const path = q ? "/shop" : shopHref({ category, page });
  const [settings, categories, alternates] = await Promise.all([
    getSiteSettings(),
    category ? getCategories().catch(() => []) : Promise.resolve([]),
    canonicalFor(path),
  ]);
  const activeCategory = category ? categories.find((c) => c.slug === category) : undefined;
  const unknownCategory = Boolean(category && categories.length > 0 && !activeCategory);
  const shouldIndex = settings.seo_indexing && !q && !unknownCategory;

  const baseTitle = activeCategory ? activeCategory.name : "Shop";
  const title = page > 1 ? `${baseTitle} – page ${page}` : baseTitle;
  const description = activeCategory
    ? `Browse ${activeCategory.name} products at ${settings.store_name} — curated selection, transparent pricing, and fast checkout.`
    : `Browse the full product catalog at ${settings.store_name}, filter by category, or search by keyword.`;
  const base = resolveSiteUrl(settings);
  const image = settings.seo_og_image_url ?? undefined;

  return {
    title,
    description,
    alternates,
    robots: robotsFor({ index: shouldIndex, follow: settings.seo_indexing }),
    openGraph: {
      type: "website",
      siteName: settings.store_name,
      title: `${title} · ${settings.store_name}`,
      description,
      url: base ? `${base}${path}` : undefined,
      images: image ? [{ url: image, alt: `${title} · ${settings.store_name}` }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      site: settings.seo_twitter ? `@${settings.seo_twitter}` : undefined,
      title: `${title} · ${settings.store_name}`,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shop</h1>
          <p className="mt-1 text-muted-foreground">Browse our full catalog.</p>
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
    <form action="/shop" className="w-full sm:w-72">
      {category && <input type="hidden" name="category" value={category} />}
      <InputGroup>
        <InputGroupInput type="search" name="q" defaultValue={q ?? ""} placeholder="Search products…" aria-label="Search products" />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

async function Catalog({ searchParams }: { searchParams: SearchParams }) {
  const { category, q, page: rawPage } = await searchParams;
  const requested = parsePage(rawPage);
  const categories = await getCategories();
  const active = categories.find((c) => c.slug === category);
  // An unknown category slug is an empty category, not the whole catalogue.
  const result =
    category && !active
      ? { items: [], total: 0, page: 1, pages: 1, perPage: PRODUCTS_PER_PAGE }
      : await getProductPage({ categoryId: active?.id, search: q, page: requested });
  // `?page=` beyond the last page → the last page (same contract as the admin lists).
  if (result.page !== requested) redirect(shopHref({ category, q, page: result.page }));
  const { first, last } = pageRange(result.page, result.perPage, result.total);

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2" aria-label="Categories">
        <CategoryPill href={shopHref({ q })} active={!category}>
          All
        </CategoryPill>
        {categories.map((c) => (
          <CategoryPill key={c.id} href={shopHref({ category: c.slug, q })} active={c.slug === category}>
            {c.name}
          </CategoryPill>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground" data-testid="shop-count">
        {productCountLabel({ total: result.total, categoryName: active?.name, q, first, last })}
      </p>
      <ProductGrid products={result.items} emptyMessage={q ? `Nothing matches “${q}”. Try a different search.` : "No products in this category yet."} />
      <ProductPagination page={result.page} total={result.total} perPage={PRODUCTS_PER_PAGE} hrefFor={(p) => shopHref({ category, q, page: p })} />
    </div>
  );
}

function CategoryPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(badgeVariants({ variant: active ? "default" : "outline" }), "h-8 rounded-full px-4 text-sm", !active && "hover:bg-accent hover:text-accent-foreground")}
    >
      {children}
    </Link>
  );
}
