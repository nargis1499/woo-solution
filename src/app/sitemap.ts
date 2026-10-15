import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";

/**
 * /sitemap.xml – home, shop, categories and every active product.
 * Empty while search engine visibility is off or no site URL is known
 * (sitemaps must contain absolute URLs).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await getSiteSettings();
  const base = resolveSiteUrl(settings);
  if (!settings.seo_indexing || !base) return [];

  const entries = await getSitemapEntries();
  return entries.map((e) => ({
    url: `${base}${e.path}`,
    lastModified: e.lastModified ? new Date(e.lastModified) : undefined,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }));
}
