import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import { getCategories, getProducts } from "@/lib/data/products";
import { FREE_SHIPPING_THRESHOLD_CENTS } from "@/lib/config";
import { getSiteSettings } from "@/lib/site-settings";
import { canonicalFor } from "@/lib/seo";
import { formatPrice } from "@/lib/format";
import { HomeProductFilter } from "@/components/home-product-filter";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-grid";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await canonicalFor("/") };
}

/**
 * Hero + the sections switched on under UI → Home page. `getSiteSettings()` is cached and
 * tagged, so the choice of sections is part of the static shell and flips the moment an
 * admin saves; the sections themselves stream in (they read the catalogue).
 */
export default async function HomePage() {
  const settings = await getSiteSettings();
  const { store_name } = settings;

  return (
    <div className="container-page space-y-14 py-10">
      {/* Hero – fully static, part of the prerendered shell */}
      <section className="relative overflow-hidden rounded-2xl bg-primary px-6 py-16 text-primary-foreground sm:px-12 sm:py-24">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-96 rounded-full bg-black/10 blur-3xl" aria-hidden />
        <Badge variant="secondary" className="mb-4 bg-white/15 text-primary-foreground hover:bg-white/15">
          <SparklesIcon /> New season
        </Badge>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">Everything you love about {store_name}, now faster.</h1>
        <p className="mt-4 max-w-xl text-lg text-primary-foreground/80">
          Browse the catalog, add to your cart and check out in seconds. Free shipping on orders over {formatPrice(FREE_SHIPPING_THRESHOLD_CENTS)}.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/shop" className={cn(buttonVariants({ size: "lg" }), "bg-background text-foreground hover:bg-background/90")}>
            Shop now
          </Link>
          <Link href="/shop?category=electronics" className={cn(buttonVariants({ size: "lg", variant: "ghost" }), "text-primary-foreground hover:bg-white/10 hover:text-primary-foreground")}>
            Explore electronics <ArrowRightIcon />
          </Link>
        </div>
      </section>

      {/* Categories – reads from Supabase → streams in */}
      {settings.home_show_categories && (
        <section aria-labelledby="home-categories" data-testid="home-categories">
          <h2 id="home-categories" className="mb-5 text-2xl font-bold tracking-tight">
            Shop by category
          </h2>
          <Suspense fallback={<CategoryTilesSkeleton />}>
            <CategoryTiles />
          </Suspense>
        </section>
      )}

      {/* Featured products */}
      {settings.home_show_featured && (
        <section aria-labelledby="home-featured" data-testid="home-featured">
          <div className="mb-5 flex items-end justify-between">
            <h2 id="home-featured" className="text-2xl font-bold tracking-tight">
              Featured products
            </h2>
            <Link href="/shop" className={buttonVariants({ variant: "link" })}>
              View all <ArrowRightIcon />
            </Link>
          </div>
          <Suspense fallback={<ProductGridSkeleton count={4} />}>
            <FeaturedProducts />
          </Suspense>
        </section>
      )}

      {/* Filtered products – the shop's category filter, heading set by the admin */}
      {settings.home_show_filter && (
        <section aria-label={settings.home_filter_title ?? "Products"} data-testid="home-filter" className="scroll-mt-24">
          {settings.home_filter_title && <h2 className="mb-5 text-2xl font-bold tracking-tight">{settings.home_filter_title}</h2>}
          <Suspense fallback={<ProductGridSkeleton count={8} />}>
            <FilteredProducts />
          </Suspense>
        </section>
      )}
    </div>
  );
}

async function FilteredProducts() {
  const [categories, products, { manage_stock }] = await Promise.all([getCategories(), getProducts(), getSiteSettings()]);
  return <HomeProductFilter categories={categories} products={products} manageStock={manage_stock} />;
}

async function CategoryTiles() {
  const categories = await getCategories();
  if (categories.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {categories.map((c) => (
        <Card key={c.id} size="sm" className="py-0 transition-colors hover:bg-accent">
          <Link href={`/shop?category=${c.slug}`} className="flex items-center justify-between px-5 py-6 font-medium">
            {c.name}
            <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </Card>
      ))}
    </div>
  );
}

function CategoryTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[72px] rounded-xl" />
      ))}
    </div>
  );
}

async function FeaturedProducts() {
  let products = await getProducts({ featuredOnly: true, limit: 8 });
  if (products.length === 0) products = await getProducts({ limit: 8 });
  return <ProductGrid products={products} emptyMessage="No products yet — run supabase/seed.sql to add the demo catalog." />;
}
