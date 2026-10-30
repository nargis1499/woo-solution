"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_RE, adminClient, echo, failure, friendlyError, isRedirectError, notice, revalidateStore, returnTo, str, type AdminFormState } from "@/lib/admin/form";
import { POSTS_TAG, postTag } from "@/lib/data/posts";
import { isUuid } from "@/lib/media/shared";
import { CANONICAL_URL_MAX, PAGE_SLUG_RE, PAGE_TITLE_MAX, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, excerptFromHtml, htmlToText, isValidCanonical, isValidImageUrl, parseTagNames, slugifyPage, tagSlug, truncate } from "@/lib/pages/shared";
import { isBlankHtml, mediaIdsFromHtml, sanitizePageHtml } from "@/lib/pages/sanitize";
import type { PageStatus } from "@/lib/types";

const LIST_PATH = "/nemesis/posts";
const editPath = (id: string) => `${LIST_PATH}/${id}`;
const postsReturn = (fd: FormData) => returnTo(fd, LIST_PATH);
const intents = ["draft", "publish", "update", "unpublish"] as const;
type Intent = (typeof intents)[number];

function revalidatePosts(slugs: (string | null | undefined)[]) {
  updateTag(POSTS_TAG);
  for (const slug of new Set(slugs.filter((s): s is string => Boolean(s)))) updateTag(postTag(slug));
  revalidatePath(LIST_PATH);
  revalidatePath("/blog");
  revalidateStore();
}

async function suggestSlug(supabase: SupabaseClient, slug: string, excludeId: string | null) {
  const { data } = await supabase.from("blog_posts").select("slug").like("slug", `${slug}%`).limit(400);
  const taken = new Set((data ?? []).filter((r: { slug: string }) => r.slug !== slug || !excludeId).map((r: { slug: string }) => r.slug));
  if (excludeId) {
    const { data: self } = await supabase.from("blog_posts").select("slug").eq("id", excludeId).maybeSingle();
    if (self?.slug) taken.delete(self.slug);
  }
  for (let i = 2; i < 200; i++) if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}`;
  return `${slug}-${Date.now().toString(36)}`;
}

async function ensureTags(supabase: SupabaseClient, names: string[]) {
  if (!names.length) return [] as string[];
  const slugs = names.map(tagSlug);
  const lookup = async () => {
    const { data, error } = await supabase.from("tags").select("id, slug").in("slug", slugs);
    if (error) throw error;
    return new Map((data ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]));
  };
  let found = await lookup();
  const missing = names.map((name, i) => ({ name, slug: slugs[i] })).filter((t) => !found.has(t.slug));
  if (missing.length) {
    const unique = [...new Map(missing.map((t) => [t.slug, t])).values()];
    const { error } = await supabase.from("tags").insert(unique);
    if (error && error.code !== "23505") throw error;
    found = await lookup();
  }
  return slugs.map((slug) => found.get(slug)).filter((id): id is string => Boolean(id));
}

async function resolveImages(supabase: SupabaseClient, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data, error } = await supabase.from("media").select("id, kind, deleted_at").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).filter((row: { kind: string; deleted_at: string | null }) => row.kind === "image" && !row.deleted_at).map((row: { id: string }) => row.id));
}

export async function savePost(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid post id.", values };
  const intent = intents.includes(str(formData, "intent", 20) as Intent) ? str(formData, "intent", 20) as Intent : "draft";
  const title = str(formData, "title", PAGE_TITLE_MAX + 1);
  const slug = slugifyPage(str(formData, "slug", 200) || title);
  const rawContent = typeof formData.get("content") === "string" ? formData.get("content") as string : "";
  const content = sanitizePageHtml(rawContent.slice(0, 400_000));
  const seoTitle = str(formData, "seo_title", SEO_TITLE_MAX + 1);
  const seoDescription = str(formData, "seo_description", SEO_DESCRIPTION_MAX + 1);
  const canonicalUrl = str(formData, "canonical_url", CANONICAL_URL_MAX + 1);
  const ogTitle = str(formData, "og_title", SEO_TITLE_MAX + 1);
  const ogDescription = str(formData, "og_description", SEO_DESCRIPTION_MAX + 1);
  const tagNames = parseTagNames(str(formData, "tags", 2000));
  const excerptInput = str(formData, "excerpt", 1000);
  let featuredMode = str(formData, "featured_image_mode", 10) || "keep";
  const featuredId = str(formData, "featured_image_media_id", 40);
  const featuredUrl = str(formData, "featured_image_url", 2100);
  let ogMode = str(formData, "og_image_mode", 10) || "keep";
  const ogId = str(formData, "og_image_media_id", 40);
  const ogUrl = str(formData, "og_image_url", 2100);
  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Title is required.";
  if (!slug || !PAGE_SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (rawContent.length > 200_000) fieldErrors.content = "The content is too long – split it into several posts.";
  if (seoTitle.length > SEO_TITLE_MAX) fieldErrors.seo_title = `Keep the SEO title under ${SEO_TITLE_MAX} characters.`;
  if (seoDescription.length > SEO_DESCRIPTION_MAX) fieldErrors.seo_description = `Keep the meta description under ${SEO_DESCRIPTION_MAX} characters.`;
  if (canonicalUrl && !isValidCanonical(canonicalUrl)) fieldErrors.canonical_url = "Enter a full URL starting with https:// (or leave it empty).";
  if (ogTitle.length > SEO_TITLE_MAX) fieldErrors.og_title = `Keep the Open Graph title under ${SEO_TITLE_MAX} characters.`;
  if (ogDescription.length > SEO_DESCRIPTION_MAX) fieldErrors.og_description = `Keep the Open Graph description under ${SEO_DESCRIPTION_MAX} characters.`;
  if (featuredMode === "url" && !featuredUrl) featuredMode = "remove";
  if (ogMode === "url" && !ogUrl) ogMode = "remove";
  const modes = ["keep", "media", "url", "remove"];
  if (!modes.includes(featuredMode) || (featuredMode === "media" && !UUID_RE.test(featuredId))) fieldErrors.featured_image_media_id = "Choose a featured image.";
  if (!modes.includes(ogMode) || (ogMode === "media" && !UUID_RE.test(ogId))) fieldErrors.og_image_media_id = "Choose a social share image.";
  if (featuredMode === "url" && !isValidImageUrl(featuredUrl)) fieldErrors.featured_image_url = "Enter a valid https image URL.";
  if (ogMode === "url" && !isValidImageUrl(ogUrl)) fieldErrors.og_image_url = "Enter a valid https image URL.";
  if (fieldErrors.title || fieldErrors.slug || fieldErrors.content || Object.keys(fieldErrors).some((k) => k.startsWith("seo_") || k.startsWith("og_") || k === "canonical_url" || k.startsWith("featured_image") || k.startsWith("og_image"))) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  const { supabase, user } = await adminClient();
  type CurrentPost = { slug: string; status: PageStatus; published_at: string | null };
  let current: CurrentPost | null = null;
  if (isEdit) {
    const { data, error } = await supabase.from("blog_posts").select("slug, status, published_at").eq("id", id).maybeSingle();
    if (error) return { error: friendlyError(error), values };
    if (!data) return { error: "This post no longer exists.", values };
    current = data as CurrentPost;
  }
  const { data: collision, error: collisionError } = await supabase.from("blog_posts").select("id").eq("slug", slug).neq("id", isEdit ? id : "00000000-0000-0000-0000-000000000000").limit(1);
  if (collisionError) return { error: friendlyError(collisionError), values };
  if (collision?.length) return { error: "Please fix the highlighted fields.", fieldErrors: { slug: `"/blog/${slug}" is already in use. Try "/blog/${await suggestSlug(supabase, slug, isEdit ? id : null)}".` }, values };

  const previousStatus = current?.status ?? "draft";
  const status: PageStatus = intent === "publish" ? "published" : intent === "unpublish" || intent === "draft" ? "draft" : previousStatus;
  if (status === "published" && (!title || isBlankHtml(content))) return { error: "Add a title and some content before publishing.", fieldErrors: { ...(!title ? { title: "Title is required." } : {}), ...(isBlankHtml(content) ? { content: "Add content before publishing." } : {}) }, values };
  try {
    const imageIds = [...new Set([...mediaIdsFromHtml(content), ...(featuredMode === "media" ? [featuredId] : []), ...(ogMode === "media" ? [ogId] : [])])];
    const images = await resolveImages(supabase, imageIds);
    if (featuredMode === "media" && !images.has(featuredId)) return { error: "Please fix the highlighted fields.", fieldErrors: { featured_image_media_id: "Choose a valid image from the Media Library." }, values };
    if (ogMode === "media" && !images.has(ogId)) return { error: "Please fix the highlighted fields.", fieldErrors: { og_image_media_id: "Choose a valid image from the Media Library." }, values };
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      title, slug, content, excerpt: excerptInput || truncate(htmlToText(content), 220) || excerptFromHtml(content) || null,
      status, seo_title: seoTitle || null, seo_description: seoDescription || null,
      canonical_url: canonicalUrl || null, robots_index: str(formData, "robots_index", 5) !== "off",
      robots_follow: str(formData, "robots_follow", 5) !== "off", og_title: ogTitle || null, og_description: ogDescription || null,
      published_at: status === "published" ? (previousStatus === "published" ? current?.published_at ?? now : now) : null,
    };
    if (featuredMode === "media") Object.assign(row, { featured_image_id: featuredId, featured_image_url: null });
    else if (featuredMode === "url") Object.assign(row, { featured_image_id: null, featured_image_url: featuredUrl });
    else if (featuredMode === "remove") Object.assign(row, { featured_image_id: null, featured_image_url: null });
    if (ogMode === "media") Object.assign(row, { og_image_id: ogId, og_image_url: null });
    else if (ogMode === "url") Object.assign(row, { og_image_id: null, og_image_url: ogUrl });
    else if (ogMode === "remove") Object.assign(row, { og_image_id: null, og_image_url: null });
    if (!isEdit) row.author_id = user.id;
    const result = isEdit ? await supabase.from("blog_posts").update(row).eq("id", id).select("id").single() : await supabase.from("blog_posts").insert(row).select("id").single();
    if (result.error) return { error: friendlyError(result.error), values };
    const postId = result.data.id as string;
    const tagIds = await ensureTags(supabase, tagNames);
    const { error: clearTags } = await supabase.from("blog_post_tags").delete().eq("post_id", postId);
    if (clearTags) throw clearTags;
    if (tagIds.length) {
      const { error } = await supabase.from("blog_post_tags").insert(tagIds.map((tag_id, position) => ({ post_id: postId, tag_id, position })));
      if (error) throw error;
    }
    const { error: clearMedia } = await supabase.from("blog_post_media").delete().eq("post_id", postId);
    if (clearMedia) throw clearMedia;
    const usedIds = mediaIdsFromHtml(content).filter((mediaId) => images.has(mediaId));
    if (usedIds.length) {
      const { error } = await supabase.from("blog_post_media").insert(usedIds.map((media_id) => ({ post_id: postId, media_id })));
      if (error) throw error;
    }
    revalidatePosts([current?.slug, slug]);
    const verb = status === "published" ? (previousStatus === "published" ? "updated" : "published") : intent === "unpublish" ? "unpublished" : isEdit ? "saved" : "saved as a draft";
    if (!isEdit) redirect(notice(editPath(postId), `"${title}" ${verb}.`));
    revalidatePath(editPath(postId));
    return { success: `"${title}" ${verb}.`, values: { slug } };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

export async function checkPostSlug(slugInput: string, excludeId: string | null): Promise<{ ok: boolean; reason?: string; suggestion?: string }> {
  const slug = slugifyPage(typeof slugInput === "string" ? slugInput : "");
  if (!slug || !PAGE_SLUG_RE.test(slug)) return { ok: false, reason: "Use lowercase letters, numbers and dashes only." };
  try {
    const { supabase } = await adminClient();
    let query = supabase.from("blog_posts").select("id").eq("slug", slug).limit(1);
    if (excludeId && isUuid(excludeId)) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    return data?.length ? { ok: false, reason: "Already used by another post.", suggestion: await suggestSlug(supabase, slug, excludeId) } : { ok: true };
  } catch { return { ok: true }; }
}

export async function deletePost(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const back = postsReturn(formData);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid post id."));
  try {
    const { supabase } = await adminClient();
    const { data: post, error } = await supabase.from("blog_posts").select("title, slug").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!post) redirect(failure(back, "Post not found."));
    const { error: deleteError } = await supabase.from("blog_posts").delete().eq("id", id);
    if (deleteError) throw deleteError;
    revalidatePosts([post.slug]);
    redirect(notice(back, `"${post.title}" deleted.`));
  } catch (e) { if (isRedirectError(e)) throw e; redirect(failure(back, friendlyError(e))); }
}

export async function setPostStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const status = str(formData, "status", 20);
  const back = postsReturn(formData);
  if (!UUID_RE.test(id) || (status !== "draft" && status !== "published")) redirect(failure(back, "Invalid post or status."));
  try {
    const { supabase } = await adminClient();
    const { data: post, error } = await supabase.from("blog_posts").select("id, title, slug, content, status, published_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!post) redirect(failure(back, "Post not found."));
    if (status === "published" && isBlankHtml(post.content)) redirect(failure(back, `"${post.title}" needs content before it can be published.`));
    const { error: updateError } = await supabase.from("blog_posts").update({ status, published_at: status === "published" ? post.published_at ?? new Date().toISOString() : null }).eq("id", id);
    if (updateError) throw updateError;
    revalidatePosts([post.slug]);
    redirect(notice(back, `"${post.title}" ${status === "published" ? "published" : "moved to drafts"}.`));
  } catch (e) { if (isRedirectError(e)) throw e; redirect(failure(back, friendlyError(e))); }
}
