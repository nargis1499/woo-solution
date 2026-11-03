import "server-only";
import type { Metadata } from "next";
import type { Page, SiteSettings } from "@/lib/types";
import { pageSeo } from "@/lib/pages/shared";
import { resolveSiteUrl } from "@/lib/site-settings";
import { robotsFor } from "@/lib/seo";

/** One metadata path for CMS articles and the promoted homepage. A homepage
 * always has / as its canonical URL, even if the page had a custom canonical. */
export function cmsPageMetadata(
  page: Page,
  settings: SiteSettings,
  homepage = false,
): Metadata {
  const seo = pageSeo(
    page,
    resolveSiteUrl(settings),
    settings.seo_indexing,
    homepage ? "/" : undefined,
  );
  const image = seo.ogImage ?? settings.seo_og_image_url ?? undefined;
  return {
    title: homepage ? { absolute: seo.title } : seo.title,
    description: seo.description ?? undefined,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    robots: robotsFor(seo.robots),
    openGraph: {
      type: homepage ? "website" : "article",
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      url: seo.canonical ?? undefined,
      siteName: settings.store_name,
      ...(!homepage
        ? {
            publishedTime: page.published_at ?? undefined,
            modifiedTime: page.updated_at,
            tags: page.tags?.map((t) => t.name),
          }
        : {}),
      images: image
        ? [
            {
              url: image,
              alt:
                page.og_image?.alt ?? page.featured_image?.alt ?? seo.ogTitle,
            },
          ]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      site: settings.seo_twitter ? `@${settings.seo_twitter}` : undefined,
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}
