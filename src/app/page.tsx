import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getProducts } from "@/lib/data/products";
import { FREE_SHIPPING_THRESHOLD_CENTS } from "@/lib/config";
import { getSiteSettings } from "@/lib/site-settings";
import { formatPrice } from "@/lib/format";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-grid";
import { ButtonLink } from "@/components/ui/button";

export default async function HomePage() {
  const { store_name } = await getSiteSettings();
  return (
    <div className="container-page space-y-14 py-10">
      {/* Hero – fully static, part of the prerendered shell */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-6 py-16 text-white sm:px-12 sm:py-24">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand-100">New season</p>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Everything you love about {store_name}, now faster.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-brand-100">
          Browse the catalog, add to your cart and check out in seconds. Free shipping on orders over{" "}
          {formatPrice(FREE_SHIPPING_THRESHOLD_CENTS)}.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/shop" size="lg" variant="light">
            Shop now
          </ButtonLink>
          <ButtonLink href="/shop?category=electronics" size="lg" variant="ghost" className="text-white hover:bg-white/10">
            Explore electronics →
          </ButtonLink>
        </div>
      </section>

      {/* Categories – reads from Supabase → streams in */}
      <section>
        <h2 className="mb-5 text-2xl font-bold tracking-tight">Shop by category</h2>
        <Suspense fallback={<CategoryTilesSkeleton />}>
          <CategoryTiles />
        </Suspense>
      </section>

      {/* Featured products */}
      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Featured products</h2>
          <Link href="/shop" className="text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">
            View all →
          </Link>
        </div>
        <Suspense fallback={<ProductGridSkeleton count={4} />}>
          <FeaturedProducts />
        </Suspense>
      </section>
    </div>
  );
}

async function CategoryTiles() {
  const categories = await getCategories();
  if (categories.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {categories.map((c) => (
        <Link
          key={c.id}
          href={`/shop?category=${c.slug}`}
          className="card flex items-center justify-between px-5 py-6 font-medium transition-colors hover:border-brand-300 hover:bg-brand-50"
        >
          {c.name}
          <span aria-hidden className="text-neutral-400">→</span>
        </Link>
      ))}
    </div>
  );
}

function CategoryTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card h-[72px] animate-pulse bg-neutral-100" />
      ))}
    </div>
  );
}

async function FeaturedProducts() {
  let products = await getProducts({ featuredOnly: true, limit: 8 });
  if (products.length === 0) products = await getProducts({ limit: 8 });
  return <ProductGrid products={products} emptyMessage="No products yet — run supabase/seed.sql to add the demo catalog." />;
}
