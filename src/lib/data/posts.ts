import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";
import type { BlogPost, Tag } from "@/lib/types";

export const POSTS_TAG = "blog-posts";
export const postTag = (slug: string) => `blog-post:${slug}`;
export const BLOG_POST_COLUMNS = "id, title, slug, content, excerpt, featured_image_id, featured_image_url, status, seo_title, seo_description, canonical_url, robots_index, robots_follow, og_title, og_description, og_image_id, og_image_url, author_id, published_at, created_at, updated_at";
export const BLOG_POST_DETAIL_COLUMNS = `${BLOG_POST_COLUMNS}, featured_image:media!blog_posts_featured_image_id_fkey(${MEDIA_REF_COLUMNS}), og_image:media!blog_posts_og_image_id_fkey(${MEDIA_REF_COLUMNS}), tags:blog_post_tags(position, tag:tags(id, name, slug))`;

type RawTagRow = { position: number; tag: Tag | null };
export function withPostTags<T extends { tags?: unknown }>(row: T): T & { tags: Tag[] } {
  const tags = Array.isArray(row.tags) ? (row.tags as RawTagRow[]).filter((r) => r.tag).sort((a, b) => a.position - b.position).map((r) => r.tag as Tag) : [];
  return { ...row, tags };
}

export const getPublishedPost = cache(async (slug: string): Promise<BlogPost | null> => unstable_cache(
  async () => {
    const supabase = createPublicClient();
    const { data, error } = await supabase.from("blog_posts").select(BLOG_POST_DETAIL_COLUMNS).eq("slug", slug).eq("status", "published").maybeSingle();
    if (error) {
      if (/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)) return null;
      throw new Error(`Failed to load blog post: ${error.message}`);
    }
    return data ? withPostTags(data as unknown as BlogPost) as BlogPost : null;
  }, ["published-blog-post", slug], { tags: [POSTS_TAG, postTag(slug)], revalidate: 3600 },
)());

export const listPublishedPosts = cache(async (limit = 50): Promise<BlogPost[]> => unstable_cache(
  async () => {
    const supabase = createPublicClient();
    const { data, error } = await supabase.from("blog_posts").select(BLOG_POST_DETAIL_COLUMNS).eq("status", "published").order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
    if (error) {
      if (/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)) return [];
      throw new Error(`Failed to load blog posts: ${error.message}`);
    }
    return (data ?? []).map((row) => withPostTags(row as unknown as BlogPost) as BlogPost);
  }, ["published-blog-posts", String(limit)], { tags: [POSTS_TAG], revalidate: 3600 },
)());

export async function getPublishedPostsForSitemap(): Promise<{ slug: string; updated_at: string }[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("blog_posts").select("slug, updated_at").eq("status", "published").eq("robots_index", true).order("published_at", { ascending: false }).limit(5000);
  if (error) return [];
  return (data ?? []) as { slug: string; updated_at: string }[];
}
