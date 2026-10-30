import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage } from "@/lib/data/pages";
import { isReservedSlug, PAGE_SLUG_RE, pageSeo } from "@/lib/pages/shared";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { PageArticle } from "@/components/page-article";

/*
 * Dynamic CMS pages: /about-us, /privacy-policy, … – one template, resolved by
 * slug. Static routes (/shop, /cart, …) always win in Next.js, and the admin
 * cannot create a page with one of those slugs (see RESERVED_SLUGS).
 *
 * Everything here reads cached, tagged data only (`getPublishedPage`,
 * `getSiteSettings`), so a missing or unpublished page is a real 404 response
 * and published pages are served from the cache until the admin changes them.
 */

/*
 * Rendered per request (no static shell of its own): the data comes from the
 * cache (`"use cache"`), so this costs one cached lookup per request, and the
 * whole article is in the first HTML flush for crawlers. Unknown slugs are
 * turned into a real 404 response by the proxy (`lib/pages/proxy-guard.ts`)
 * before they reach this file; `notFound()` below is the safety net.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!PAGE_SLUG_RE.test(slug) || slug.length > 120 || isReservedSlug(slug)) return null;
  return getPublishedPage(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const [page, settings] = await Promise.all([load(slug), getSiteSettings()]);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };

  const seo = pageSeo(page, resolveSiteUrl(settings), settings.seo_indexing);
  const image = seo.ogImage ?? settings.seo_og_image_url ?? undefined;
  return {
    title: seo.title,
    description: seo.description ?? undefined,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    robots: { index: seo.robots.index, follow: seo.robots.follow },
    openGraph: {
      type: "article",
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      url: seo.canonical ?? undefined,
      siteName: settings.store_name,
      publishedTime: page.published_at ?? undefined,
      modifiedTime: page.updated_at,
      tags: page.tags?.map((t) => t.name),
      images: image ? [{ url: image, alt: page.og_image?.alt ?? page.featured_image?.alt ?? seo.ogTitle }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function DynamicPage({ params }: { params: Params }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();
  return <PageArticle page={page} editHref={`/nemesis/pages/${page.id}`} editLabel="Edit page" />;
}
