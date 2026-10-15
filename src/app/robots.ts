import type { MetadataRoute } from "next";
import { NOINDEX_PATHS } from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";

/**
 * /robots.txt – generated from Settings → SEO.
 * "Search engine visibility" off → every crawler is told to stay away
 * (together with the <meta name="robots" content="noindex"> tag).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSiteSettings();
  const base = resolveSiteUrl(settings);

  if (!settings.seo_indexing) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: NOINDEX_PATHS }],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  };
}
