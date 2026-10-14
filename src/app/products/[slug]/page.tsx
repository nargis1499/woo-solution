import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { getProductBySlug, getProducts } from "@/lib/data/products";
import { FREE_SHIPPING_THRESHOLD_CENTS } from "@/lib/config";
import { formatPrice } from "@/lib/format";
import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { ProductGrid } from "@/components/product-grid";
import { ProductPurchasePanel } from "./product-detail";

type Params = Promise<{ slug: string }>;

// Dedupe the lookup between generateMetadata and the page body.
const loadProduct = cache(getProductBySlug);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: product.description ?? undefined,
    openGraph: product.image_url ? { images: [{ url: product.image_url }] } : undefined,
  };
}

export default function ProductPage({ params }: { params: Params }) {
  return (
    <div className="container-page py-10">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetails params={params} />
      </Suspense>
    </div>
  );
}

async function ProductDetails({ params }: { params: Params }) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  return (
    <>
      <nav className="mb-6 text-sm text-neutral-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-neutral-900">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-neutral-900">Shop</Link>
        {product.category && (
          <>
            <span className="mx-2">/</span>
            <Link href={`/shop?category=${product.category.slug}`} className="hover:text-neutral-900">
              {product.category.name}
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="text-neutral-900">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          sizes="(min-width: 1024px) 50vw, 100vw"
          priority
          className="rounded-2xl"
        />

        <div className="space-y-6">
          <div>
            {product.category && (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">{product.category.name}</p>
            )}
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{product.name}</h1>
            <Price
              cents={product.price_cents}
              compareAtCents={product.compare_at_price_cents}
              className="mt-3 text-2xl"
            />
          </div>

          {product.description && (
            <p className="leading-relaxed text-neutral-700">{product.description}</p>
          )}

          <ProductPurchasePanel product={product} />

          <ul className="space-y-1 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
            <li>Free shipping on orders over {formatPrice(FREE_SHIPPING_THRESHOLD_CENTS)}.</li>
            <li>Cash on delivery available.</li>
            <li>SKU: {product.id.slice(0, 8).toUpperCase()}</li>
          </ul>
        </div>
      </div>

      <Suspense fallback={null}>
        <RelatedProducts product={product} />
      </Suspense>
    </>
  );
}

async function RelatedProducts({ product }: { product: Awaited<ReturnType<typeof getProductBySlug>> }) {
  if (!product?.category) return null;
  const related = (await getProducts({ categorySlug: product.category.slug, limit: 5 }))
    .filter((p) => p.id !== product.id)
    .slice(0, 4);
  if (related.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="mb-5 text-2xl font-bold tracking-tight">Related products</h2>
      <ProductGrid products={related} />
    </section>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-2" aria-hidden>
      <div className="aspect-square animate-pulse rounded-2xl bg-neutral-200" />
      <div className="space-y-4">
        <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
        <div className="h-9 w-3/4 animate-pulse rounded bg-neutral-200" />
        <div className="h-7 w-28 animate-pulse rounded bg-neutral-200" />
        <div className="h-20 w-full animate-pulse rounded bg-neutral-200" />
        <div className="h-12 w-64 animate-pulse rounded bg-neutral-200" />
      </div>
    </div>
  );
}
