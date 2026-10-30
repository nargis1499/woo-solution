import "server-only";
import { requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { BLOG_POST_COLUMNS, BLOG_POST_DETAIL_COLUMNS, withPostTags } from "@/lib/data/posts";
import type { BlogPost, PageStatus } from "@/lib/types";
import { MEDIA_REF_COLUMNS } from "@/lib/media/shared";

export type AdminPostListOptions = { q?: string; status?: PageStatus | ""; page?: number; perPage?: number };
export type AdminPostList = { items: BlogPost[]; total: number; page: number; perPage: number };
const LIST_COLUMNS = `${BLOG_POST_COLUMNS.replace("content, ", "")}, featured_image:media!blog_posts_featured_image_id_fkey(${MEDIA_REF_COLUMNS}), author:profiles(id, full_name, email), tags:blog_post_tags(position, tag:tags(id, name, slug))`;
const FORM_COLUMNS = `${BLOG_POST_DETAIL_COLUMNS}, author:profiles(id, full_name, email)`;
const escapeLike = (value: string) => value.replace(/[%_\\]/g, (m) => `\\${m}`);

export async function adminListPosts(options: AdminPostListOptions = {}): Promise<AdminPostList> {
  await requireAdmin();
  const supabase = await createClient();
  const perPage = Math.max(1, Math.min(100, options.perPage ?? 10));
  const search = options.q ? `title.ilike.%${escapeLike(options.q)}%,slug.ilike.%${escapeLike(options.q)}%` : null;
  const build = (columns: string, head: boolean) => {
    let query = supabase.from("blog_posts").select(columns, { count: "exact", head });
    if (search) query = query.or(search);
    if (options.status) query = query.eq("status", options.status);
    return query;
  };
  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load blog posts: ${countError.message}`);
  const total = count ?? 0;
  const page = Math.min(Math.max(1, options.page ?? 1), Math.max(1, Math.ceil(total / perPage)));
  const { data, error } = await build(LIST_COLUMNS, false).order("updated_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
  if (error) throw new Error(`Failed to load blog posts: ${error.message}`);
  return { items: (data ?? []).map((r) => withPostTags(r as unknown as BlogPost) as BlogPost), total, page, perPage };
}

export async function adminGetPost(id: string): Promise<BlogPost | null> {
  await requireAdmin();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("blog_posts").select(FORM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load blog post: ${error.message}`);
  return data ? withPostTags(data as unknown as BlogPost) as BlogPost : null;
}
