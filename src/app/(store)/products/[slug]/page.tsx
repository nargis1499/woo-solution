import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { BanknoteIcon, PackageCheckIcon, TruckIcon } from "lucide-react";
import { getProductBySlug, getProducts } from "@/lib/data/products";
import { canonicalFor } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { FREE_SHIPPING_THRESHOLD_CENTS } from "@/lib/config";
import { formatPrice } from "@/lib/format";
import { Price } from "@/components/price";
import { ProductGallery } from "@/components/product-gallery";
import { slidesFor } from "@/lib/media/shared";
import { ProductGrid } from "@/components/product-grid";
import { Badge } from "@/components/ui/badge";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductPurchasePanel } from "./product-detail";

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
    <div className="container-page py-10">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductDetails params={params} />
      </Suspense>
    </div>
  );
}

async function ProductDetails({ params }: { params: Params }) {
  const { slug } = await params;
  // Both read here, in the dynamic part of the page (loadProduct() is uncached), so the
  // stock switch from Settings → WooCommerce is fresh on every navigation.
  const [product, { manage_stock }] = await Promise.all([loadProduct(slug), getSiteSettings()]);
  if (!product) notFound();

  return (
    <>
      <PageBreadcrumbs
        className="mb-6"
        items={[
          { label: "Home", href: "/" },
          { label: "Shop", href: "/shop" },
          ...(product.category ? [{ label: product.category.name, href: `/shop?category=${product.category.slug}` }] : []),
          { label: product.name },
        ]}
      />

      <div className="grid gap-10 lg:grid-cols-2">
        <ProductGallery slides={slidesFor(product)} />
        <div className="space-y-6">
          <div>
            {product.category && (
              <Link href={`/shop?category=${product.category.slug}`}>
                <Badge variant="secondary" className="mb-3">
                  {product.category.name}
                </Badge>
              </Link>
            )}
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{product.name}</h1>
            <Price cents={product.price_cents} compareAtCents={product.compare_at_price_cents} className="mt-3 text-2xl" />
          </div>
          {product.description && <p className="leading-relaxed text-muted-foreground">{product.description}</p>}
          <ProductPurchasePanel product={product} manageStock={manage_stock} />
          <Separator />
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <TruckIcon className="size-4" aria-hidden /> Free shipping on orders over {formatPrice(FREE_SHIPPING_THRESHOLD_CENTS)}.
            </li>
            <li className="flex items-center gap-2">
              <BanknoteIcon className="size-4" aria-hidden /> Cash on delivery available.
            </li>
            <li className="flex items-center gap-2">
              <PackageCheckIcon className="size-4" aria-hidden /> SKU: {product.id.slice(0, 8).toUpperCase()}
            </li>
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
  const related = (await getProducts({ categorySlug: product.category.slug, limit: 5 })).filter((p) => p.id !== product.id).slice(0, 4);
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
      <Skeleton className="aspect-square rounded-2xl" />
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-12 w-64" />
      </div>
    </div>
  );
}
