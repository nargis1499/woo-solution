import { cmsPageMetadata } from "@/lib/pages/metadata";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPublishedPage } from "@/lib/data/pages";
import { isReservedSlug, PAGE_SLUG_RE, pageHref } from "@/lib/pages/shared";
import {
  breadcrumbJsonLd,
  NOINDEX,
  pageJsonLd,
  serializeJsonLd,
} from "@/lib/seo";
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
  if (!page) return { title: "Page not found", robots: NOINDEX };

  return cmsPageMetadata(page, settings, page.id === settings.home_page_id);
}

export default async function DynamicPage({ params }: { params: Params }) {
  const { slug } = await params;
  const [page, settings] = await Promise.all([load(slug), getSiteSettings()]);
  if (!page) notFound();
  // Temporary redirect: homepage assignments can change, so never cache a 308.
  if (page.id === settings.home_page_id) redirect("/");

  const base = resolveSiteUrl(settings);
  const path = pageHref(page.slug);
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: page.title }];
  const structuredData = [
    pageJsonLd(page, settings),
    breadcrumbJsonLd(base, breadcrumbItems, path),
  ].filter(Boolean);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <PageArticle
        page={page}
        breadcrumbItems={breadcrumbItems}
        editHref={`/nemesis/pages/${page.id}`}
        editLabel="Edit page"
      />
    </>
  );
}
