"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UUID_RE,
  adminClient,
  count,
  echo,
  failure,
  friendlyError,
  idsFrom,
  isRedirectError,
  notice,
  returnTo,
  revalidateStore,
  str,
  type AdminFormState,
} from "@/lib/admin/form";
import { PAGES_TAG, pageTag } from "@/lib/data/pages";
import { MENU_TAG } from "@/lib/menu";
import { isUuid } from "@/lib/media/shared";
import {
  CANONICAL_URL_MAX,
  PAGE_CONTENT_MAX,
  PAGE_SLUG_RE,
  PAGE_TITLE_MAX,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  htmlToText,
  isReservedSlug,
  isValidCanonical,
  isValidImageUrl,
  parseTagNames,
  slugifyPage,
  tagSlug,
  truncate,
} from "@/lib/pages/shared";
import { isBlankHtml, mediaIdsFromHtml, sanitizePageHtml } from "@/lib/pages/sanitize";
import type { PageStatus } from "@/lib/types";

/* ──────────────────────────────────────────────────────────────────────────
 * Pages (CMS) – every write goes through here: validation, authorisation
 * (assertAdmin + RLS), sanitisation and cache invalidation.
 * ────────────────────────────────────────────────────────────────────────── */

const LIST_PATH = "/nemesis/pages";
const pagesReturn = (fd: FormData) => returnTo(fd, LIST_PATH);
const editPath = (id: string) => `${LIST_PATH}/${id}`;

type Intent = "draft" | "publish" | "update" | "unpublish";
const INTENTS: Intent[] = ["draft", "publish", "update", "unpublish"];

/** Everything that may render a page or its listing – old and new slug included. */
function revalidatePages(slugs: (string | null | undefined)[]) {
  updateTag(PAGES_TAG);
  updateTag(MENU_TAG); // header / footer items that link to a page follow its slug and published state
  for (const slug of new Set(slugs.filter((s): s is string => Boolean(s)))) updateTag(pageTag(slug));
  revalidatePath(LIST_PATH);
  revalidateStore(); // storefront router cache + sitemap
}

/** `about-us` taken → `about-us-2` (first free suffix). */
async function suggestSlug(supabase: SupabaseClient, slug: string, excludeId: string | null): Promise<string> {
  // "about-us-2" is taken → offer "about-us-3"; but only treat a trailing
  // number as a counter when the stem itself is a page ("summer-2026" must
  // become "summer-2026-2", not "summer-2").
  const stem = slug.replace(/-\d+$/, "");
  const candidates = stem !== slug ? [stem, slug] : [slug];
  let query = supabase.from("pages").select("slug").or(candidates.map((c) => `slug.like.${c}*`).join(",")).limit(400);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug));
  const base = stem !== slug && taken.has(stem) ? stem : slug;
  for (let n = 2; n < 200; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

function isSlugConflict(e: unknown): boolean {
  const record = typeof e === "object" && e !== null ? (e as { code?: unknown; message?: unknown }) : null;
  const message = typeof record?.message === "string" ? record.message : "";
  return record?.code === "23505" || /pages_slug_key|duplicate key/.test(message);
}

/** Library images referenced by the form: must exist, be images and not sit in the trash. */
async function resolveImages(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.from("media").select("id, kind, deleted_at").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).filter((m: { kind: string; deleted_at: string | null }) => m.kind === "image" && !m.deleted_at).map((m: { id: string }) => m.id));
}

/** Creates missing tags (case-insensitive) and returns ids in the submitted order. */
async function ensureTags(supabase: SupabaseClient, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const slugs = names.map(tagSlug);
  const lookup = async () => {
    const { data, error } = await supabase.from("tags").select("id, name, slug").in("slug", slugs);
    if (error) throw error;
    return new Map((data ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]));
  };
  let found = await lookup();
  const missing = names.map((name, i) => ({ name, slug: slugs[i] })).filter((t) => !found.has(t.slug));
  if (missing.length) {
    const unique = [...new Map(missing.map((t) => [t.slug, t])).values()];
    const { error } = await supabase.from("tags").insert(unique);
    // a concurrent save may have created the same tag – the second lookup picks it up
    if (error && error.code !== "23505") throw error;
    found = await lookup();
  }
  return slugs.map((s) => found.get(s)).filter((id): id is string => Boolean(id));
}

/** Replaces the page's tag links and content-image links in one go. */
async function syncRelations(supabase: SupabaseClient, pageId: string, tagIds: string[], mediaIds: string[]) {
  const { error: clearTags } = await supabase.from("page_tags").delete().eq("page_id", pageId);
  if (clearTags) throw clearTags;
  if (tagIds.length) {
    const { error } = await supabase.from("page_tags").insert(tagIds.map((tag_id, position) => ({ page_id: pageId, tag_id, position })));
    if (error) throw error;
  }
  const { error: clearMedia } = await supabase.from("page_media").delete().eq("page_id", pageId);
  if (clearMedia) throw clearMedia;
  if (mediaIds.length) {
    const { error } = await supabase.from("page_media").insert(mediaIds.map((media_id) => ({ page_id: pageId, media_id })));
    if (error) throw error;
  }
}

/** The one thing a page needs before it can go live. */
function publishProblems(title: string, content: string): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!title) problems.title = "Add a title before publishing.";
  if (isBlankHtml(content)) problems.content = "Add some content before publishing.";
  return problems;
}

/**
 * Create / update a page. Buttons submit `intent`:
 *   draft     save (or keep) as draft
 *   publish   save and publish
 *   update    save, keep the current status
 *   unpublish save and take offline
 */
export async function savePage(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid page id.", values };

  // ── validate ──────────────────────────────────────────────────────────────
  const fieldErrors: Record<string, string> = {};
  const intent = (INTENTS.includes(str(formData, "intent", 20) as Intent) ? str(formData, "intent", 20) : "draft") as Intent;
  const title = str(formData, "title", PAGE_TITLE_MAX + 1);
  const slug = slugifyPage(str(formData, "slug", 200) || title);
  const rawContent = typeof formData.get("content") === "string" ? (formData.get("content") as string) : "";
  const content = sanitizePageHtml(rawContent.slice(0, PAGE_CONTENT_MAX * 2));
  const seoTitle = str(formData, "seo_title", SEO_TITLE_MAX + 1);
  const seoDescription = str(formData, "seo_description", SEO_DESCRIPTION_MAX + 1);
  const canonicalUrl = str(formData, "canonical_url", CANONICAL_URL_MAX + 1);
  const robotsIndex = str(formData, "robots_index", 5) !== "off";
  const robotsFollow = str(formData, "robots_follow", 5) !== "off";
  const ogTitle = str(formData, "og_title", SEO_TITLE_MAX + 1);
  const ogDescription = str(formData, "og_description", SEO_DESCRIPTION_MAX + 1);
  const tagNames = parseTagNames(str(formData, "tags", 2000));
  let featuredMode = str(formData, "featured_image_mode", 10) || "keep";
  const featuredId = str(formData, "featured_image_media_id", 40);
  const featuredUrl = str(formData, "featured_image_url", 2100);
  let ogMode = str(formData, "og_image_mode", 10) || "keep";
  const ogId = str(formData, "og_image_media_id", 40);
  const ogUrl = str(formData, "og_image_url", 2100);

  if (!title) fieldErrors.title = "Title is required.";
  else if (title.length > PAGE_TITLE_MAX) fieldErrors.title = `Keep the title under ${PAGE_TITLE_MAX} characters.`;
  if (!slug || !PAGE_SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  else if (isReservedSlug(slug)) fieldErrors.slug = `"/${slug}" is reserved by the shop – pick another slug.`;
  if (rawContent.length > PAGE_CONTENT_MAX) fieldErrors.content = "The content is too long – split it into several pages.";
  if (seoTitle.length > SEO_TITLE_MAX) fieldErrors.seo_title = `Keep the SEO title under ${SEO_TITLE_MAX} characters.`;
  if (seoDescription.length > SEO_DESCRIPTION_MAX) fieldErrors.seo_description = `Keep the meta description under ${SEO_DESCRIPTION_MAX} characters.`;
  if (canonicalUrl && !isValidCanonical(canonicalUrl)) fieldErrors.canonical_url = "Enter a full URL starting with https:// (or leave it empty to use the page's own URL).";
  if (ogTitle.length > SEO_TITLE_MAX) fieldErrors.og_title = `Keep the Open Graph title under ${SEO_TITLE_MAX} characters.`;
  if (ogDescription.length > SEO_DESCRIPTION_MAX) fieldErrors.og_description = `Keep the Open Graph description under ${SEO_DESCRIPTION_MAX} characters.`;
  const IMAGE_MODES = ["keep", "media", "url", "remove"];
  // "Use a URL" left blank = no image
  if (featuredMode === "url" && !featuredUrl) featuredMode = "remove";
  if (ogMode === "url" && !ogUrl) ogMode = "remove";
  if (!IMAGE_MODES.includes(featuredMode) || (featuredMode === "media" && !UUID_RE.test(featuredId))) fieldErrors.featured_image_media_id = "Pick an image from the Media Library.";
  if (!IMAGE_MODES.includes(ogMode) || (ogMode === "media" && !UUID_RE.test(ogId))) fieldErrors.og_image_media_id = "Pick an image from the Media Library.";
  if (featuredMode === "url" && !isValidImageUrl(featuredUrl)) fieldErrors.featured_image_url = "Enter a full image URL starting with https://.";
  if (ogMode === "url" && !isValidImageUrl(ogUrl)) fieldErrors.og_image_url = "Enter a full image URL starting with https://.";
  if (intent === "publish" || intent === "update") Object.assign(fieldErrors, publishProblems(title, content));
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { user, supabase } = await adminClient();

    type Current = { id: string; slug: string; status: PageStatus; published_at: string | null };
    let current: Current | null = null;
    if (isEdit) {
      const { data, error } = await supabase.from("pages").select("id, slug, status, published_at").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return { error: "This page no longer exists.", values };
      current = data as Current;
    }
    // "update" keeps whatever the page is – for a draft that means it stays a draft
    const wasPublished = current?.status === "published";

    // ── media references ────────────────────────────────────────────────────
    const contentIds = mediaIdsFromHtml(content);
    const images = await resolveImages(supabase, [...new Set([...(featuredMode === "media" ? [featuredId] : []), ...(ogMode === "media" ? [ogId] : []), ...contentIds])]);
    if (featuredMode === "media" && !images.has(featuredId)) return { error: "Please fix the highlighted fields.", fieldErrors: { featured_image_media_id: "That image is no longer in the Media Library – pick another one." }, values };
    if (ogMode === "media" && !images.has(ogId)) return { error: "Please fix the highlighted fields.", fieldErrors: { og_image_media_id: "That image is no longer in the Media Library – pick another one." }, values };

    // ── status ──────────────────────────────────────────────────────────────
    const status: PageStatus = intent === "publish" ? "published" : intent === "unpublish" ? "draft" : intent === "update" ? (wasPublished ? "published" : "draft") : "draft";
    const publishedAt = status === "published" ? (wasPublished ? current!.published_at : new Date().toISOString()) : null;

    const row: Record<string, unknown> = {
      title,
      slug,
      content,
      excerpt: truncate(htmlToText(content), 300) || null,
      status,
      published_at: publishedAt,
      seo_title: seoTitle || null,
      seo_description: seoDescription || null,
      canonical_url: canonicalUrl || null,
      robots_index: robotsIndex,
      robots_follow: robotsFollow,
      og_title: ogTitle || null,
      og_description: ogDescription || null,
    };
    // exactly one of <image>_id / <image>_url is kept per image
    if (featuredMode === "media") Object.assign(row, { featured_image_id: featuredId, featured_image_url: null });
    else if (featuredMode === "url") Object.assign(row, { featured_image_id: null, featured_image_url: featuredUrl });
    else if (featuredMode === "remove") Object.assign(row, { featured_image_id: null, featured_image_url: null });
    if (ogMode === "media") Object.assign(row, { og_image_id: ogId, og_image_url: null });
    else if (ogMode === "url") Object.assign(row, { og_image_id: null, og_image_url: ogUrl });
    else if (ogMode === "remove") Object.assign(row, { og_image_id: null, og_image_url: null });
    if (!isEdit) row.author_id = user.id;

    const result = isEdit
      ? await supabase.from("pages").update(row).eq("id", id).select("id").single()
      : await supabase.from("pages").insert(row).select("id").single();
    if (result.error) {
      if (isSlugConflict(result.error)) {
        const suggestion = await suggestSlug(supabase, slug, isEdit ? id : null);
        return { error: "Please fix the highlighted fields.", fieldErrors: { slug: `"/${slug}" is already used by another page – try "/${suggestion}".` }, values: { ...values, slug_suggestion: suggestion } };
      }
      throw result.error;
    }
    const pageId = result.data.id as string;

    const tagIds = await ensureTags(supabase, tagNames);
    await syncRelations(supabase, pageId, tagIds, contentIds.filter((m) => images.has(m)));

    revalidatePages([current?.slug, slug]);

    const verb = status === "published" ? (wasPublished ? "updated" : "published") : intent === "unpublish" ? "unpublished" : isEdit ? "saved" : "saved as a draft";
    if (!isEdit) redirect(notice(editPath(pageId), `"${title}" ${verb}.`));
    revalidatePath(editPath(pageId));
    return { success: `"${title}" ${verb}.`, values: { slug } };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

/** Inline status change from the list (and bulk publish / unpublish). */
async function changeStatus(ids: string[], status: PageStatus): Promise<{ changed: number; skipped: string[] }> {
  const { supabase } = await adminClient();
  const { data, error } = await supabase.from("pages").select("id, title, slug, status, content, published_at").in("id", ids);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; title: string; slug: string; status: PageStatus; content: string; published_at: string | null }[];
  const skipped: string[] = [];
  const slugs: string[] = [];
  let changed = 0;
  const now = new Date().toISOString();
  for (const page of rows) {
    if (page.status === status) continue;
    if (status === "published" && Object.keys(publishProblems(page.title, page.content)).length) {
      skipped.push(page.title);
      continue;
    }
    const { error: updError } = await supabase
      .from("pages")
      .update({ status, published_at: status === "published" ? now : null })
      .eq("id", page.id);
    if (updError) throw updError;
    changed++;
    slugs.push(page.slug);
  }
  if (changed) revalidatePages(slugs);
  return { changed, skipped };
}

export async function setPageStatus(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const status = str(formData, "status", 20);
  const back = pagesReturn(formData);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid page id."));
  if (status !== "draft" && status !== "published") redirect(failure(back, "Invalid status."));
  try {
    const { supabase } = await adminClient();
    const { data: page, error } = await supabase.from("pages").select("title").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!page) redirect(failure(back, "Page not found."));
    const { changed, skipped } = await changeStatus([id], status);
    if (skipped.length) redirect(failure(back, `"${page.title}" needs a title and some content before it can be published.`));
    redirect(notice(back, changed ? `"${page.title}" ${status === "published" ? "published" : "moved to drafts"}.` : `"${page.title}" is already ${status}.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

async function bulkStatus(formData: FormData, status: PageStatus): Promise<void> {
  const back = pagesReturn(formData);
  const ids = idsFrom(formData);
  if (ids.length === 0) redirect(failure(back, "Select at least one page first."));
  try {
    const { changed, skipped } = await changeStatus(ids, status);
    const what = status === "published" ? "published" : "moved to drafts";
    if (changed === 0 && skipped.length) redirect(failure(back, `Nothing published – ${count(skipped.length, "page needs", "pages need")} a title and some content first.`));
    const tail = skipped.length ? ` ${count(skipped.length, "page was", "pages were")} skipped (empty content).` : "";
    redirect(notice(back, `${count(changed, "page", "pages")} ${what}.${tail}`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

export async function publishPages(formData: FormData): Promise<void> {
  return bulkStatus(formData, "published");
}

export async function unpublishPages(formData: FormData): Promise<void> {
  return bulkStatus(formData, "draft");
}

export async function deletePage(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const back = pagesReturn(formData);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid page id."));
  try {
    const { supabase } = await adminClient();
    const { data: page, error } = await supabase.from("pages").select("title, slug").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!page) redirect(failure(back, "Page not found."));

    const { error: delError } = await supabase.from("pages").delete().eq("id", id);
    if (delError) throw delError;

    revalidatePages([page.slug]);
    redirect(notice(back, `"${page.title}" deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/** Deletes every selected page in one statement (Media Library files stay in the library). */
export async function deletePages(formData: FormData): Promise<void> {
  const back = pagesReturn(formData);
  const ids = idsFrom(formData);
  if (ids.length === 0) redirect(failure(back, "Select at least one page first."));
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("pages").delete().in("id", ids).select("slug");
    if (error) throw error;
    const deleted = (data ?? []) as { slug: string }[];
    if (deleted.length === 0) redirect(failure(back, "Those pages no longer exist."));

    revalidatePages(deleted.map((p) => p.slug));
    redirect(notice(back, `${count(deleted.length, "page", "pages")} deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/** Live "is this slug free?" check for the form (the save re-validates on the server anyway). */
export async function checkPageSlug(slug: string, excludeId: string | null): Promise<{ ok: boolean; reason?: string; suggestion?: string }> {
  const clean = slugifyPage(typeof slug === "string" ? slug : "");
  if (!clean || !PAGE_SLUG_RE.test(clean)) return { ok: false, reason: "Use lowercase letters, numbers and dashes only." };
  if (isReservedSlug(clean)) return { ok: false, reason: `"/${clean}" is reserved by the shop.` };
  try {
    const { supabase } = await adminClient();
    let query = supabase.from("pages").select("id").eq("slug", clean).limit(1);
    if (excludeId && isUuid(excludeId)) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    if (data && data.length) return { ok: false, reason: "Already used by another page.", suggestion: await suggestSlug(supabase, clean, excludeId && isUuid(excludeId) ? excludeId : null) };
    return { ok: true };
  } catch {
    return { ok: true }; // never block typing on a hiccup – the save validates for real
  }
}
