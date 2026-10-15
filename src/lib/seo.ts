import "server-only";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { getSiteSettings, resolveSiteUrl, telegramHref, whatsappHref } from "@/lib/site-settings";
import type { SiteSettings } from "@/lib/types";

/* ──────────────────────────────────────────────────────────────────────────
 * Everything the SEO tab controls, in one place:
 *  - <head> metadata (title, description, robots, verification, Open Graph,
 *    Twitter cards, favicon)                → buildSiteMetadata()
 *  - robots.txt + sitemap.xml               → src/app/robots.ts / sitemap.ts
 *  - Organization / WebSite JSON-LD         → siteJsonLd()
 * ────────────────────────────────────────────────────────────────────────── */

export const SITEMAP_TAG = "sitemap";

/** Storefront pages that should never be indexed (private, transactional or admin). */
export const NOINDEX_PATHS = ["/nemesis", "/checkout", "/cart", "/orders", "/login", "/signup", "/auth"];

export function siteTitle(s: Pick<SiteSettings, "store_name" | "seo_title">): string {
  return s.seo_title || s.store_name;
}

export function siteDescription(s: Pick<SiteSettings, "store_name" | "tagline" | "seo_description">): string {
  return s.seo_description || s.tagline || `${s.store_name} — a modern storefront built with Next.js and Supabase.`;
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
    robots: s.seo_indexing
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
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

/** Shared by the private/transactional pages: never indexed, whatever the global switch says. */
export const NOINDEX: NonNullable<Metadata["robots"]> = { index: false, follow: false };

export type SitemapEntry = { path: string; lastModified?: string; changeFrequency: "daily" | "weekly" | "monthly"; priority: number };

/**
 * Relative sitemap entries (home, shop, categories, active products). Cached
 * and tagged – every admin write calls `updateTag(SITEMAP_TAG)`.
 */
export async function getSitemapEntries(): Promise<SitemapEntry[]> {
  "use cache";
  cacheTag(SITEMAP_TAG);
  cacheLife("hours");

  const entries: SitemapEntry[] = [
    { path: "/", changeFrequency: "daily", priority: 1 },
    { path: "/shop", changeFrequency: "daily", priority: 0.9 },
  ];

  try {
    const supabase = createPublicClient();
    const [categories, products] = await Promise.all([
      supabase.from("categories").select("slug").order("sort_order", { ascending: true }),
      supabase.from("products").select("slug, updated_at").eq("is_active", true).order("created_at", { ascending: false }).limit(5000),
    ]);
    for (const c of categories.data ?? []) {
      entries.push({ path: `/shop?category=${encodeURIComponent(c.slug)}`, changeFrequency: "weekly", priority: 0.7 });
    }
    for (const p of products.data ?? []) {
      entries.push({ path: `/products/${encodeURIComponent(p.slug)}`, lastModified: p.updated_at ?? undefined, changeFrequency: "weekly", priority: 0.8 });
    }
  } catch {
    // keep the static pages – a flaky database should not blank the sitemap
  }
  return entries;
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
