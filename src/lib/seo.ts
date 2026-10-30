import "server-only";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { getPublishedPagesForSitemap } from "@/lib/data/pages";
import { getPublishedPostsForSitemap } from "@/lib/data/posts";
import { parseProductFeatures } from "@/lib/home-sections";
import { slidesFor } from "@/lib/media/shared";
import { inputFromMicros, moneyFromSettings } from "@/lib/money";
import { featuredImage, htmlToText, pageHref, pageSeo, truncate } from "@/lib/pages/shared";
import { postHref, postSeo } from "@/lib/posts/shared";
import { getSiteSettings, resolveSiteUrl, telegramHref, whatsappHref } from "@/lib/site-settings";
import { priceRange } from "@/lib/variations";
import type { BlogPost, Page, Product, SiteSettings } from "@/lib/types";

/* ──────────────────────────────────────────────────────────────────────────
 * Everything the SEO tab controls, in one place:
 *  - <head> metadata (title, description, robots, verification, Open Graph,
 *    Twitter cards, favicon)                → buildSiteMetadata()
 *  - robots.txt + sitemap.xml               → src/app/robots.ts / sitemap.ts
 *  - Organization / WebSite / Product /
 *    WebPage / BlogPosting / BreadcrumbList → *JsonLd()
 * ────────────────────────────────────────────────────────────────────────── */

export const SITEMAP_TAG = "sitemap";

/** Storefront pages that should never be indexed (private, transactional, API or admin). */
export const NOINDEX_PATHS = [
  "/nemesis",
  "/checkout",
  "/cart",
  "/orders",
  "/notifications",
  "/login",
  "/signup",
  "/auth",
  "/preview",
  "/api",
];

export function siteTitle(s: Pick<SiteSettings, "store_name" | "seo_title">): string {
  return s.seo_title || s.store_name;
}

export function siteDescription(s: Pick<SiteSettings, "store_name" | "tagline" | "seo_description">): string {
  return s.seo_description || s.tagline || `${s.store_name} — a modern storefront built with Next.js and Supabase.`;
}

/**
 * Per-page `Metadata["robots"]` helper that preserves Google rich-preview directives
 * (`max-image-preview: large`, `max-snippet: -1`, `max-video-preview: -1`) whenever
 * a route overrides `robots` (Next.js shallow-replaces `robots` per route).
 */
export function robotsFor({
  index,
  follow,
}: {
  index: boolean;
  follow: boolean;
}): NonNullable<Metadata["robots"]> {
  if (index) {
    return {
      index: true,
      follow,
      googleBot: {
        index: true,
        follow,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    };
  }
  return {
    index: false,
    follow,
    ...(!follow ? { nocache: true } : {}),
    googleBot: { index: false, follow },
  };
}

/** Shared by the private/transactional pages: never indexed, whatever the global switch says. */
export const NOINDEX: NonNullable<Metadata["robots"]> = robotsFor({ index: false, follow: false });

/** Safe serializer for `<script type="application/ld+json">` payloads. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function absoluteUrl(urlOrPath: string, base: string | null): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (!base) return urlOrPath;
  return `${base}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

/** Root `generateMetadata()` – merged by Next.js with the per-page titles/descriptions. */
export function buildSiteMetadata(s: SiteSettings): Metadata {
  const base = resolveSiteUrl(s);
  const title = siteTitle(s);
  const description = siteDescription(s);
  const image = s.seo_og_image_url ?? undefined;

  return {
    metadataBase: base ? new URL(base) : undefined,
    title: { default: title, template: `%s · ${s.store_name}` },
    description,
    applicationName: s.store_name,
    icons: { icon: s.favicon_url ?? "/favicon.ico", shortcut: s.favicon_url ?? "/favicon.ico", apple: s.favicon_url ?? undefined },
    robots: robotsFor({ index: s.seo_indexing, follow: s.seo_indexing }),
    verification: {
      google: s.seo_google_verification ?? undefined,
      other: s.seo_bing_verification ? { "msvalidate.01": s.seo_bing_verification } : undefined,
    },
    openGraph: {
      type: "website",
      siteName: s.store_name,
      title,
      description,
      url: base ?? undefined,
      locale: "en_US",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      site: s.seo_twitter ? `@${s.seo_twitter}` : undefined,
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/**
 * `alternates.canonical` for a public page – only when the site URL is known,
 * otherwise Next would fall back to http://localhost:3000.
 */
export async function canonicalFor(path: string): Promise<Metadata["alternates"]> {
  const base = resolveSiteUrl(await getSiteSettings());
  return base ? { canonical: `${base}${path}` } : undefined;
}

export type SitemapEntry = { path: string; lastModified?: string; changeFrequency: "daily" | "weekly" | "monthly"; priority: number };

/**
 * Relative sitemap entries (home, shop, categories, active products, pages, posts).
 * Cached and tagged – every admin write calls `updateTag(SITEMAP_TAG)`.
 */
const getCachedSitemapEntries = unstable_cache(
  async (): Promise<SitemapEntry[]> => {
    const entries: SitemapEntry[] = [
      { path: "/", changeFrequency: "daily", priority: 1 },
      { path: "/shop", changeFrequency: "daily", priority: 0.9 },
      { path: "/blog", changeFrequency: "daily", priority: 0.7 },
    ];

    try {
      const supabase = createPublicClient();
      const [categories, products, pages, posts] = await Promise.all([
        supabase.from("categories").select("slug").order("sort_order", { ascending: true }),
        supabase.from("products").select("slug, updated_at").eq("is_active", true).order("created_at", { ascending: false }).limit(5000),
        getPublishedPagesForSitemap(),
        getPublishedPostsForSitemap(),
      ]);
      for (const c of categories.data ?? []) {
        entries.push({ path: `/shop?category=${encodeURIComponent(c.slug)}`, changeFrequency: "weekly", priority: 0.7 });
      }
      for (const p of products.data ?? []) {
        entries.push({ path: `/products/${encodeURIComponent(p.slug)}`, lastModified: p.updated_at ?? undefined, changeFrequency: "weekly", priority: 0.8 });
      }
      for (const page of pages) {
        entries.push({ path: `/${encodeURIComponent(page.slug)}`, lastModified: page.updated_at, changeFrequency: "monthly", priority: 0.6 });
      }
      for (const post of posts) {
        entries.push({ path: `/blog/${encodeURIComponent(post.slug)}`, lastModified: post.updated_at, changeFrequency: "monthly", priority: 0.6 });
      }
    } catch {
      // keep the static pages – a flaky database should not blank the sitemap
    }
    return entries;
  },
  ["sitemap-entries"],
  { tags: [SITEMAP_TAG], revalidate: 3600 },
);

export async function getSitemapEntries(): Promise<SitemapEntry[]> {
  return getCachedSitemapEntries();
}

/** Organization + WebSite structured data for the storefront <head>. */
export async function siteJsonLd(): Promise<Record<string, unknown>[] | null> {
  const s = await getSiteSettings();
  const base = resolveSiteUrl(s);
  if (!base) return null;

  const sameAs = [telegramHref(s.telegram), s.seo_twitter ? `https://x.com/${s.seo_twitter}` : null].filter((v): v is string => Boolean(v));
  const contactPoint = s.support_email || s.whatsapp
    ? [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          ...(s.support_email ? { email: s.support_email } : {}),
          ...(s.whatsapp ? { telephone: `+${s.whatsapp.replace(/\D/g, "")}`, url: whatsappHref(s.whatsapp) } : {}),
        },
      ]
    : undefined;

  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${base}/#organization`,
      name: s.store_name,
      url: base,
      ...(s.favicon_url || s.seo_og_image_url ? { logo: s.seo_og_image_url ?? s.favicon_url } : {}),
      ...(s.tagline ? { description: s.tagline } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      ...(contactPoint ? { contactPoint } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: siteTitle(s),
      url: base,
      publisher: { "@id": `${base}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${base}/shop?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

/** Schema.org `BreadcrumbList` JSON-LD for product pages, CMS pages and blog posts. */
export function breadcrumbJsonLd(
  base: string | null,
  items: { label: string; href?: string }[],
  currentPath?: string,
): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => {
      const isLast = idx === items.length - 1;
      const rawHref = item.href ?? (isLast ? currentPath : undefined);
      const url = base && rawHref ? absoluteUrl(rawHref, base) : undefined;
      return {
        "@type": "ListItem",
        position: idx + 1,
        name: item.label,
        ...(url ? { item: url } : {}),
      };
    }),
  };
}

/** Meta / structured-data description for a product, with a keyword-rich catalog fallback. */
export function productSeoDescription(product: Product, storeName: string): string {
  const explicit = product.description?.trim();
  if (explicit) return truncate(explicit.replace(/\s+/g, " "), 160);

  const features = parseProductFeatures(product.features, 3);
  const qualifier = [product.brand, product.category?.name].filter(Boolean).join(" · ");
  const base = qualifier
    ? `Shop ${product.name} (${qualifier}) at ${storeName}.`
    : `Shop ${product.name} at ${storeName}.`;
  const detail = features.length > 0 ? ` Highlights: ${features.join(", ")}.` : "";
  return truncate(`${base}${detail}`, 160);
}

/** Schema.org `Product` + `Offer` / `AggregateOffer` JSON-LD matching the displayed storefront currency. */
export function productJsonLd(product: Product, settings: SiteSettings): Record<string, unknown> {
  const base = resolveSiteUrl(settings);
  const path = `/products/${encodeURIComponent(product.slug)}`;
  const canonicalUrl = base ? `${base}${path}` : null;
  const money = moneyFromSettings(settings);
  const slides = slidesFor(product);
  const images = slides.map((s) => absoluteUrl(s.src, base)).filter(Boolean);
  const description = product.description?.trim() || productSeoDescription(product, settings.store_name);

  const attributes = product.attributes ?? [];
  const activeVariations = (product.variations ?? []).filter((v) => v.is_active);
  const isVariable = (product.type ?? "simple") === "variable" && attributes.length > 0;
  const features = parseProductFeatures(product.features, 6);

  const seller = {
    "@type": "Organization",
    name: settings.store_name,
    ...(base ? { "@id": `${base}/#organization`, url: base } : {}),
  };

  let offers: Record<string, unknown>;
  if (isVariable && activeVariations.length > 0) {
    const range = priceRange(activeVariations);
    const anyInStock = !settings.manage_stock || activeVariations.some((v) => v.stock > 0);
    offers = {
      "@type": "AggregateOffer",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      priceCurrency: money.currency,
      lowPrice: inputFromMicros(range?.min ?? product.price_micros, money),
      highPrice: inputFromMicros(range?.max ?? product.price_micros, money),
      offerCount: activeVariations.length,
      availability: anyInStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      offers: activeVariations.map((v) => ({
        "@type": "Offer",
        name: v.label,
        ...(canonicalUrl ? { url: canonicalUrl } : {}),
        priceCurrency: money.currency,
        price: inputFromMicros(v.price_micros, money),
        availability:
          !settings.manage_stock || v.stock > 0
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
        ...(v.sku ? { sku: v.sku } : {}),
        seller,
      })),
    };
  } else {
    const inStock = isVariable
      ? false
      : !settings.manage_stock || product.stock > 0;
    offers = {
      "@type": "Offer",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      priceCurrency: money.currency,
      price: inputFromMicros(product.price_micros, money),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      ...(product.sku ? { sku: product.sku } : {}),
      seller,
    };
  }

  const additionalProperty = [
    ...attributes.map((attr) => ({
      "@type": "PropertyValue",
      name: attr.name,
      value: attr.options.join(", "),
    })),
    ...features.map((feature) => ({
      "@type": "PropertyValue",
      name: "Feature",
      value: feature,
    })),
  ];

  const primarySku = product.sku ?? activeVariations.find((v) => v.sku)?.sku ?? undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    ...(canonicalUrl ? { "@id": `${canonicalUrl}#product`, url: canonicalUrl } : {}),
    name: product.name,
    description,
    ...(images.length > 0 ? { image: images } : {}),
    ...(primarySku ? { sku: primarySku } : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
    ...(product.category ? { category: product.category.name } : {}),
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
    offers,
  };
}

/** Schema.org `WebPage` JSON-LD for published CMS pages (`/[slug]`). */
export function pageJsonLd(page: Page, settings: SiteSettings): Record<string, unknown> {
  const base = resolveSiteUrl(settings);
  const seo = pageSeo(page, base, settings.seo_indexing);
  const url = seo.canonical ?? (base ? `${base}${pageHref(page.slug)}` : undefined);
  const hero = featuredImage(page);
  const imageUrl = seo.ogImage ?? hero?.src ?? undefined;
  const keywords = page.tags?.map((t) => t.name).filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    ...(url ? { "@id": `${url}#webpage`, url } : {}),
    name: page.title,
    headline: page.title,
    ...(seo.description ? { description: seo.description } : {}),
    datePublished: page.published_at ?? page.created_at,
    dateModified: page.updated_at,
    ...(imageUrl ? { image: [absoluteUrl(imageUrl, base)] } : {}),
    ...(keywords && keywords.length > 0 ? { keywords: keywords.join(", ") } : {}),
    inLanguage: "en",
    ...(base
      ? {
          isPartOf: { "@id": `${base}/#website` },
          publisher: { "@id": `${base}/#organization` },
        }
      : {
          publisher: { "@type": "Organization", name: settings.store_name },
        }),
  };
}

/** Schema.org `BlogPosting` JSON-LD for published blog posts (`/blog/[slug]`). */
export function postJsonLd(post: BlogPost, settings: SiteSettings): Record<string, unknown> {
  const base = resolveSiteUrl(settings);
  const seo = postSeo(post, base, settings.seo_indexing);
  const url = seo.canonical ?? (base ? `${base}${postHref(post.slug)}` : undefined);
  const hero = featuredImage(post);
  const imageUrl = seo.ogImage ?? hero?.src ?? settings.seo_og_image_url ?? undefined;
  const plainText = post.content ? htmlToText(post.content) : "";
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
  const keywords = post.tags?.map((t) => t.name).filter(Boolean);
  const logoUrl = settings.seo_og_image_url ?? settings.favicon_url ?? undefined;

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    ...(url
      ? {
          "@id": `${url}#article`,
          url,
          mainEntityOfPage: { "@type": "WebPage", "@id": url },
        }
      : {}),
    headline: post.title,
    ...(seo.description ? { description: seo.description } : {}),
    datePublished: post.published_at ?? post.created_at,
    dateModified: post.updated_at,
    ...(imageUrl ? { image: [absoluteUrl(imageUrl, base)] } : {}),
    ...(keywords && keywords.length > 0 ? { keywords: keywords.join(", ") } : {}),
    ...(wordCount > 0 ? { wordCount } : {}),
    inLanguage: "en",
    author: post.author?.full_name
      ? { "@type": "Person", name: post.author.full_name }
      : {
          "@type": "Organization",
          name: settings.store_name,
          ...(base ? { "@id": `${base}/#organization`, url: base } : {}),
        },
    publisher: {
      "@type": "Organization",
      name: settings.store_name,
      ...(base ? { "@id": `${base}/#organization`, url: base } : {}),
      ...(logoUrl
        ? { logo: { "@type": "ImageObject", url: absoluteUrl(logoUrl, base) } }
        : {}),
    },
  };
}

/** Schema.org `Blog` JSON-LD for the `/blog` index page. */
export function blogIndexJsonLd(posts: BlogPost[], settings: SiteSettings): Record<string, unknown> {
  const base = resolveSiteUrl(settings);
  const blogUrl = base ? `${base}/blog` : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    ...(blogUrl ? { "@id": `${blogUrl}#blog`, url: blogUrl } : {}),
    name: `Blog · ${settings.store_name}`,
    description: `Stories, updates and helpful articles from ${settings.store_name}.`,
    publisher: base
      ? { "@id": `${base}/#organization` }
      : { "@type": "Organization", name: settings.store_name },
    ...(posts.length > 0
      ? {
          blogPost: posts.slice(0, 20).map((post) => {
            const postUrl = base ? `${base}${postHref(post.slug)}` : undefined;
            const hero = featuredImage(post);
            return {
              "@type": "BlogPosting",
              headline: post.title,
              ...(postUrl ? { url: postUrl } : {}),
              datePublished: post.published_at ?? post.created_at,
              dateModified: post.updated_at,
              ...(post.excerpt ? { description: post.excerpt } : {}),
              ...(hero?.src ? { image: [absoluteUrl(hero.src, base)] } : {}),
            };
          }),
        }
      : {}),
  };
}
