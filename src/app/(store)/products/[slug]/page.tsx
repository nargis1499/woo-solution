import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { getProductBySlug, getProducts } from "@/lib/data/products";
import { StorefrontBlockContent } from "@/components/storefront-block-content";
import { slidesFor, mediaUrl } from "@/lib/media/shared";
import {
  breadcrumbJsonLd,
  NOINDEX,
  productJsonLd,
  productSeoDescription,
  robotsFor,
  serializeJsonLd,
} from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { ProductGrid } from "@/components/product-grid";
import { AdminEditButton } from "@/components/admin-edit-button";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ProductInformationTabs, ProductShowcase } from "./product-detail";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// Dedupe the lookup between generateMetadata and the page body.
const loadProduct = cache(getProductBySlug);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const [product, settings] = await Promise.all([loadProduct(slug), getSiteSettings()]);
  if (!product) return { title: "Product not found", robots: NOINDEX };

  const base = resolveSiteUrl(settings);
  const path = `/products/${encodeURIComponent(product.slug)}`;
  const canonical = product.canonical_url || (base ? `${base}${path}` : undefined);
  const description = productSeoDescription(product, settings.store_name);
  const slides = slidesFor(product);
  const shareSrc = product.og_image?.path ? mediaUrl(product.og_image.path) : product.og_image_url;
  const ogImages =
    shareSrc ? [{ url: shareSrc, alt: product.name }] : slides.length > 0
      ? slides.map((s) => ({ url: s.src, alt: s.alt || product.name }))
      : settings.seo_og_image_url
        ? [{ url: settings.seo_og_image_url, alt: product.name }]
        : undefined;

  return {
    title: product.seo_title || product.name,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: robotsFor({ index: settings.seo_indexing && product.robots_index !== false, follow: settings.seo_indexing && product.robots_follow !== false }),
    openGraph: {
      type: "website",
      siteName: settings.store_name,
      title: product.og_title || product.seo_title || product.name,
      description: product.og_description || description,
      url: canonical,
      images: ogImages,
    },
    twitter: {
      card: ogImages ? "summary_large_image" : "summary",
      site: settings.seo_twitter ? `@${settings.seo_twitter}` : undefined,
      title: product.og_title || product.seo_title || product.name,
      description: product.og_description || description,
      images: ogImages?.map((img) => img.url),
    },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  // Loaded at the top level (not hidden behind a skeleton Suspense boundary) so unknown
  // slugs return a real HTTP 404 and Googlebot receives the full product markup immediately.
  const [product, settings] = await Promise.all([loadProduct(slug), getSiteSettings()]);
  if (!product) notFound();

  const base = resolveSiteUrl(settings);
  const path = `/products/${encodeURIComponent(product.slug)}`;
  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Shop", href: "/shop" },
    ...(product.category
      ? [{ label: product.category.name, href: `/shop?category=${encodeURIComponent(product.category.slug)}` }]
      : []),
    { label: product.name },
  ];
  const structuredData = [
    productJsonLd(product, settings),
    breadcrumbJsonLd(base, breadcrumbItems, path),
  ].filter(Boolean);

  return (
    <div className="dark min-h-screen bg-[#070b18] text-slate-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <div className="container-page py-6 sm:py-9">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <PageBreadcrumbs
            className="text-slate-400 [&_a]:text-slate-400 [&_a:hover]:text-white [&_[aria-current=page]]:text-slate-200"
            items={breadcrumbItems}
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
        {product.content?.trim() && (
          <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-8" aria-labelledby="product-description-heading">
            <h2 id="product-description-heading" className="mb-6 text-xl font-semibold">Detailed description</h2>
            <StorefrontBlockContent content={product.content} />
          </section>
        )}
        <ProductInformationTabs product={product} />

        <Suspense fallback={null}>
          <RelatedProducts product={product} />
        </Suspense>
      </div>
    </div>
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
        <Link href={`/shop?category=${encodeURIComponent(product.category.slug)}`} className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">View all</Link>
      </div>
      <ProductGrid products={related} />
    </section>
  );
}
