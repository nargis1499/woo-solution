import type { BlogPost } from "@/lib/types";
import { pageSeo, slugifyPage, type PageSeo } from "@/lib/pages/shared";

export const POST_TITLE_MAX = 200;
export const POST_CONTENT_MAX = 200_000;
export const POST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const postHref = (slug: string) => `/blog/${slug}`;
export const postPreviewHref = (id: string) => `/preview/posts/${id}`;
export const slugifyPost = (value: string) => slugifyPage(value);
export function postSeo(post: BlogPost, siteUrl: string | null, indexingEnabled = true): PageSeo {
  return { ...pageSeo(post, siteUrl, indexingEnabled), canonical: post.canonical_url?.trim() || (siteUrl ? `${siteUrl}${postHref(post.slug)}` : null) };
}
