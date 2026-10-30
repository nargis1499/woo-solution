import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { getProductBySlug, getProducts } from "@/lib/data/products";
import { canonicalFor } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { ProductGrid } from "@/components/product-grid";
import { AdminEditButton } from "@/components/admin-edit-button";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductInformationTabs, ProductShowcase } from "./product-detail";

type Params = Promise<{ slug: string }>;

// Dedupe the lookup between generateMetadata and the page body.
const loadProduct = cache(getProductBySlug);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return { title: "Product not found", robots: { index: false } };
  return {
    title: product.name,
    description: product.description ?? undefined,
    alternates: await canonicalFor(`/products/${encodeURIComponent(product.slug)}`),
    openGraph: { type: "website", title: product.name, description: product.description ?? undefined, images: product.image_url ? [{ url: product.image_url }] : undefined },
  };
}

export default function ProductPage({ params }: { params: Params }) {
  return (
    <main className="dark min-h-screen bg-[#070b18] text-slate-100">
      <div className="container-page py-6 sm:py-9">
        <Suspense fallback={<ProductSkeleton />}>
          <ProductDetails params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ProductDetails({ params }: { params: Params }) {
  const { slug } = await params;
  // The stock switch comes from Settings and is read dynamically on navigation.
  const [product, settings] = await Promise.all([loadProduct(slug), getSiteSettings()]);
  if (!product) notFound();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageBreadcrumbs
          className="text-slate-400 [&_a]:text-slate-400 [&_a:hover]:text-white [&_[aria-current=page]]:text-slate-200"
          items={[
            { label: "Home", href: "/" },
            { label: "Shop", href: "/shop" },
            ...(product.category ? [{ label: product.category.name, href: `/shop?category=${product.category.slug}` }] : []),
            { label: product.name },
          ]}
        />
        <AdminEditButton
          href={`/nemesis/products/${product.id}`}
          label="Edit product"
          className="border-slate-700 bg-slate-900/90 text-slate-100 hover:border-indigo-400/70 hover:bg-slate-800 hover:text-white dark:border-slate-700 dark:bg-slate-900/90 dark:hover:border-indigo-400/70 dark:hover:bg-slate-800"
        />
      </div>

      <ProductShowcase
        product={product}
        manageStock={settings.manage_stock}
        shippingEnabled={settings.shipping_enabled}
        shippingRateMicros={settings.shipping_rate_micros}
      />
      <ProductInformationTabs product={product} />

      <Suspense fallback={null}>
        <RelatedProducts product={product} />
      </Suspense>
    </>
  );
}

async function RelatedProducts({ product }: { product: NonNullable<Awaited<ReturnType<typeof getProductBySlug>>> }) {
  if (!product.category) return null;
  const related = (await getProducts({ categorySlug: product.category.slug, limit: 5 })).filter((item) => item.id !== product.id).slice(0, 4);
  if (related.length === 0) return null;
  return (
    <section className="mt-12 border-t border-slate-800 pt-10 sm:mt-16 sm:pt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="mb-1 text-xs font-bold tracking-[0.18em] text-indigo-300 uppercase">Discover more</p><h2 className="text-2xl font-bold tracking-tight text-white">Related products</h2></div>
        <Link href={`/shop?category=${product.category.slug}`} className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">View all</Link>
      </div>
      <ProductGrid products={related} />
    </section>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 xl:gap-12" aria-hidden>
      <Skeleton className="aspect-[16/10] max-h-[21rem] w-full rounded-2xl sm:max-h-[23rem] lg:max-h-[24rem]" />
      <div className="space-y-4"><Skeleton className="h-5 w-36" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-7 w-36" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /></div>
    </div>
  );
}
