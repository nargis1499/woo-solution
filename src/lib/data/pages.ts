import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";
import type { Page, Tag } from "@/lib/types";

/*
 * Storefront reads for CMS pages. Everything here is public data read with the
 * cookie-less client, cached and tagged – the admin actions call
 * `updateTag(PAGES_TAG)` / `updateTag(pageTag(slug))` after every write, so a
 * publish, edit, unpublish or delete is visible on the next request.
 */

export const PAGES_TAG = "pages";
export const pageTag = (slug: string) => `page:${slug}`;

export const PAGE_COLUMNS =
  "id, title, slug, content, excerpt, featured_image_id, featured_image_url, status, seo_title, seo_description, canonical_url, robots_index, robots_follow, og_title, og_description, og_image_id, og_image_url, author_id, published_at, created_at, updated_at";

/** Page row + featured / share image + tags (what the template and the form render). */
export const PAGE_DETAIL_COLUMNS = `${PAGE_COLUMNS}, featured_image:media!pages_featured_image_id_fkey(${MEDIA_REF_COLUMNS}), og_image:media!pages_og_image_id_fkey(${MEDIA_REF_COLUMNS}), tags:page_tags(position, tag:tags(id, name, slug))`;

type RawTagRow = { position: number; tag: Tag | null };

/** Flattens the `page_tags(position, tag)` embed into an ordered `tags` array. */
export function withTags<T extends { tags?: unknown }>(row: T): T & { tags: Tag[] } {
  const raw = Array.isArray(row.tags) ? (row.tags as RawTagRow[]) : [];
  const tags = raw
    .filter((r) => r.tag)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.tag as Tag);
  return { ...row, tags };
}

/** Published page by slug – null for drafts and unknown slugs (RLS hides drafts from the anon key anyway). */
export async function getPublishedPage(slug: string): Promise<Page | null> {
  return unstable_cache(
    async (): Promise<Page | null> => {
      const supabase = createPublicClient();
      const { data, error } = await supabase.from("pages").select(PAGE_DETAIL_COLUMNS).eq("slug", slug).eq("status", "published").maybeSingle();
      if (error) {
        // Before the pages migration ran there is nothing to show – behave like "no such page".
        if (/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)) return null;
        throw new Error(`Failed to load page: ${error.message}`);
      }
      return data ? (withTags(data as unknown as Page) as Page) : null;
    },
    ["published-page", slug],
    { tags: [PAGES_TAG, pageTag(slug)], revalidate: 3600 },
  )();
}

/** Slugs + timestamps of indexable published pages (sitemap). */
export async function getPublishedPagesForSitemap(): Promise<{ slug: string; updated_at: string }[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("pages").select("slug, updated_at").eq("status", "published").eq("robots_index", true).order("published_at", { ascending: false }).limit(5000);
  if (error) return [];
  return (data ?? []) as { slug: string; updated_at: string }[];
}
