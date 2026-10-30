"use server";

import { revalidatePath, updateTag } from "next/cache";
import { cookies } from "next/headers";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import { runModelCompletion } from "@/lib/ai/client";
import { loadAiSettingsForAction, resolveProviderApiKey } from "@/lib/ai/settings";
import { createClient } from "@/lib/supabase/server";
import type { MediaFolder, MediaItem, MediaUsage } from "@/lib/types";
import {
  BRANDING_FOLDER,
  MAX_MEDIA_BULK,
  MAX_MEDIA_BYTES,
  MEDIA_PER_PAGE_COOKIE,
  MEDIA_VIEW_COOKIE,
  extensionOf,
  isEditableImage,
  isUuid,
  mediaKindFor,
  mediaUrl,
  parseMediaParams,
  parseMediaPerPage,
  sanitizeFilename,
  validateMediaFile,
  withExtension,
  type MediaListParams,
  type MediaView,
  type EditOps,
  type MediaPage,
  type OptimizeOptions,
} from "@/lib/media/shared";
import {
  MEDIA_COLUMNS,
  downloadObject,
  editImageBuffer,
  generateVariants,
  getMediaUsage,
  inspectImage,
  listMedia,
  newObjectPath,
  objectPathsOf,
  optimizeImageBuffer,
  removeObjects,
  sha256,
  uploadObject,
} from "@/lib/media/server";
import { LEGACY_BUCKETS, isLegacyBucket, legacyBucketStatus, legacyDisplayName, legacyPublicUrl, type LegacyBucket, type LegacyBucketStatus } from "@/lib/media/legacy";

/* ──────────────────────────────────────────────────────────────────────────
 * Shared
 * ────────────────────────────────────────────────────────────────────────── */

export type MediaResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const okay = <T>(data: T, message?: string): { ok: true; data: T; message?: string } => ({ ok: true, data, message });

function friendlyError(e: unknown): string {
  if (e instanceof AdminAuthError) return e.message;
  const record = typeof e === "object" && e !== null ? (e as { message?: unknown; code?: unknown }) : null;
  const message = e instanceof Error ? e.message : typeof record?.message === "string" ? record.message : typeof e === "string" ? e : "";
  const code = typeof record?.code === "string" ? record.code : "";
  if (code === "23505" || /duplicate key/.test(message)) return "That name is already taken.";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "You are not allowed to do that.";
  if (code === "42P01" || /relation .* does not exist|Could not find the table/i.test(message)) return "Database update required – run supabase/migrations/20261019000000_media_library.sql first.";
  return message || "Something went wrong. Please try again.";
}

async function adminClient() {
  const user = await assertAdmin();
  const supabase = await createClient();
  return { user, supabase };
}

function revalidateMedia(storefront = false) {
  revalidatePath("/nemesis/media");
  if (storefront) revalidatePath("/", "layout"); // product images changed under the storefront's feet
}

const cleanIds = (ids: unknown): string[] => (Array.isArray(ids) ? [...new Set(ids.filter(isUuid))].slice(0, MAX_MEDIA_BULK) : []);
const count = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

const FALLBACK_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  ico: "image/x-icon", bmp: "image/bmp", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Browsers leave `type` empty for less common extensions – fall back to the extension, then octet-stream. */
function mimeFor(name: string, type: string): string {
  const t = (type || "").toLowerCase().split(";")[0].trim();
  if (t && t !== "application/octet-stream") return t;
  return FALLBACK_MIME[extensionOf(name)] ?? "application/octet-stream";
}

async function loadItem(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<MediaItem | null> {
  const { data, error } = await supabase.from("media").select(MEDIA_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as MediaItem) ?? null;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Products and the site settings keep a denormalised copy of a file's URL –
 * point them at the new URL (or clear them) when the file moves or goes away.
 */
async function repointReferences(supabase: Db, mediaIds: string[], urlFor: (mediaId: string) => string | null) {
  for (const id of mediaIds) {
    const { error } = await supabase.from("products").update({ image_url: urlFor(id) }).eq("image_media_id", id);
    if (error) console.error(`[media] could not repoint products for ${id}: ${error.message}`);
  }
  const { data: settings } = await supabase.from("site_settings").select("favicon_media_id, seo_og_image_media_id").eq("id", 1).maybeSingle();
  const row = (settings ?? {}) as { favicon_media_id?: string | null; seo_og_image_media_id?: string | null };
  const patch: Record<string, string | null> = {};
  if (row.favicon_media_id && mediaIds.includes(row.favicon_media_id)) patch.favicon_url = urlFor(row.favicon_media_id);
  if (row.seo_og_image_media_id && mediaIds.includes(row.seo_og_image_media_id)) patch.seo_og_image_url = urlFor(row.seo_og_image_media_id);
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("site_settings").update(patch).eq("id", 1);
    if (error) console.error(`[media] could not repoint site settings: ${error.message}`);
    else updateTag(SITE_SETTINGS_TAG);
  }
}

/** Finds (or creates) a folder by name – used for uploads that belong somewhere specific, e.g. "Branding". */
async function folderIdByName(supabase: Db, name: string): Promise<string | null> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!clean) return null;
  const { data: existing } = await supabase.from("media_folders").select("id").ilike("name", clean.replace(/[%_]/g, "\\$&")).limit(1).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase.from("media_folders").insert({ name: clean }).select("id").single();
  if (error) {
    const { data: raced } = await supabase.from("media_folders").select("id").ilike("name", clean).limit(1).maybeSingle();
    return (raced?.id as string | undefined) ?? null;
  }
  return created.id as string;
}

/**
 * Inspects `buffer` (already uploaded to `path`), generates the image sizes
 * and inserts the library row. Shared by browser uploads and the legacy import.
 */
async function storeMediaRow(
  supabase: Db,
  userId: string,
  input: { path: string; name: string; mime: string; buffer: Buffer; folderId: string | null; alt?: string | null },
): Promise<MediaItem> {
  const { path, name, mime, buffer } = input;
  const kind = mediaKindFor(mime, name);
  const info = kind === "image" ? await inspectImage(buffer) : { width: null, height: null, animated: false, format: null };
  const { variants, variants_size } = kind === "image" ? await generateVariants(supabase, buffer, mime, path, info) : { variants: {}, variants_size: 0 };
  const row = {
    folder_id: input.folderId,
    name,
    path,
    mime_type: mime,
    kind,
    size: buffer.length,
    width: info.width,
    height: info.height,
    alt: input.alt ?? null,
    hash: sha256(buffer),
    variants,
    variants_size,
    uploaded_by: userId,
  };
  const { data, error } = await supabase.from("media").insert(row).select(MEDIA_COLUMNS).single();
  if (error) {
    await removeObjects(supabase, [path, ...Object.values(variants).map((v) => v!.path)]);
    throw error;
  }
  return data as unknown as MediaItem;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Browsing (used by the Media Picker – the page itself renders on the server)
 * ────────────────────────────────────────────────────────────────────────── */

export async function browseMedia(raw: Partial<Record<keyof MediaListParams, string>>): Promise<MediaResult<MediaPage>> {
  try {
    await assertAdmin();
    const params = parseMediaParams(raw as Record<string, string | undefined>, { per: 24 });
    return okay(await listMedia(params));
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function listFolders(): Promise<MediaResult<MediaFolder[]>> {
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media_folders").select("id, name, created_at").order("name");
    if (error) throw error;
    return okay((data ?? []) as MediaFolder[]);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/** Library rows by id (the picker uses it to select an already-stored duplicate). */
export async function mediaItems(ids: string[]): Promise<MediaResult<MediaItem[]>> {
  const list = cleanIds(ids);
  if (list.length === 0) return okay([]);
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media").select(MEDIA_COLUMNS).in("id", list).is("deleted_at", null);
    if (error) throw error;
    return okay((data ?? []) as unknown as MediaItem[]);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function usageFor(ids: string[]): Promise<MediaResult<Record<string, MediaUsage[]>>> {
  try {
    await assertAdmin();
    return okay(await getMediaUsage(cleanIds(ids)));
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/** Remembers grid / list and page size for the next visit (bare /nemesis/media URL). */
export async function rememberMediaPrefs(prefs: { view?: MediaView; per?: number }): Promise<void> {
  const store = await cookies();
  const opts = { path: "/", maxAge: 31536000, sameSite: "lax" as const };
  if (prefs.view === "grid" || prefs.view === "list") store.set(MEDIA_VIEW_COOKIE, prefs.view, opts);
  if (prefs.per) store.set(MEDIA_PER_PAGE_COOKIE, String(parseMediaPerPage(prefs.per)), opts);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Uploads – the browser streams straight to Storage (progress events, no
 * server body limit); the server validates, hashes and registers afterwards.
 * ────────────────────────────────────────────────────────────────────────── */

export type UploadTicket = {
  name: string;
  path: string | null;
  error: string | null;
  duplicateOf: { id: string; name: string } | null;
};

export type PrepareUploadsResult = { token: string; tickets: UploadTicket[] };

export async function prepareUploads(
  files: { name: string; size: number; type: string; hash: string }[],
): Promise<MediaResult<PrepareUploadsResult>> {
  try {
    const { supabase } = await adminClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return fail("Your session has expired – please sign in again.");

    const batch = (Array.isArray(files) ? files : []).slice(0, MAX_MEDIA_BULK);
    const hashes = [...new Set(batch.map((f) => f.hash).filter((h) => /^[0-9a-f]{64}$/.test(h)))];
    const existing = new Map<string, { id: string; name: string }>();
    if (hashes.length) {
      const { data, error } = await supabase.from("media").select("id, name, hash").in("hash", hashes).is("deleted_at", null);
      if (error) throw error;
      for (const row of data ?? []) if (row.hash && !existing.has(row.hash)) existing.set(row.hash, { id: row.id, name: row.name });
    }

    const tickets: UploadTicket[] = batch.map((f) => {
      const name = String(f.name ?? "").slice(0, 200);
      const problem = validateMediaFile({ name, size: Number(f.size), type: String(f.type ?? "") });
      return {
        name,
        path: problem ? null : newObjectPath(name),
        error: problem,
        duplicateOf: existing.get(f.hash) ?? null,
      };
    });
    return okay({ token, tickets });
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function registerUpload(input: {
  path: string;
  name: string;
  type: string;
  folderId?: string | null;
  /** Alternative to `folderId`: file it under this folder, creating it on first use. */
  folderName?: string | null;
}): Promise<MediaResult<MediaItem>> {
  const path = String(input.path ?? "");
  if (!/^\d{4}\/\d{2}\/[a-z0-9-]+(\.[a-z0-9]{1,8})?$/.test(path)) return fail("Invalid upload path.");
  try {
    const { user, supabase } = await adminClient();
    const name = String(input.name ?? "").trim().slice(0, 200) || path.split("/").pop()!;
    const mime = mimeFor(name, String(input.type ?? ""));

    // the server is the judge: size, type and hash come from the stored bytes, not the browser
    const { buffer } = await downloadObject(path);
    const problem = validateMediaFile({ name, size: buffer.length, type: mime });
    if (problem || buffer.length > MAX_MEDIA_BYTES) {
      await removeObjects(supabase, [path]);
      return fail(problem ?? `The file is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);
    }

    const folderId = isUuid(input.folderId) ? input.folderId : input.folderName ? await folderIdByName(supabase, String(input.folderName)) : null;
    return okay(await storeMediaRow(supabase, user.id, { path, name, mime, buffer, folderId }));
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metadata
 * ────────────────────────────────────────────────────────────────────────── */

export async function renameMedia(id: string, name: string): Promise<MediaResult<MediaItem>> {
  if (!isUuid(id)) return fail("Invalid file.");
  const next = String(name ?? "").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 200);
  if (!next) return fail("Enter a file name.");
  try {
    const { supabase } = await adminClient();
    const item = await loadItem(supabase, id);
    if (!item) return fail("This file no longer exists.");
    const ext = extensionOf(item.name);
    const final = ext && extensionOf(next) !== ext ? `${next.replace(/\.[a-z0-9]{1,8}$/i, "")}.${ext}` : next; // keep the real extension
    const { data, error } = await supabase.from("media").update({ name: final }).eq("id", id).select(MEDIA_COLUMNS).single();
    if (error) throw error;
    revalidateMedia();
    return okay(data as unknown as MediaItem, "File renamed.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateMediaAlt(id: string, alt: string): Promise<MediaResult<MediaItem>> {
  if (!isUuid(id)) return fail("Invalid file.");
  try {
    const { supabase } = await adminClient();
    const value = String(alt ?? "").trim().slice(0, 300) || null;
    const { data, error } = await supabase.from("media").update({ alt: value }).eq("id", id).select(MEDIA_COLUMNS).single();
    if (error) throw error;
    revalidateMedia(true); // storefront <img alt>
    return okay(data as unknown as MediaItem, "Alt text saved.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function moveMedia(ids: string[], folderId: string | null): Promise<MediaResult<number>> {
  const list = cleanIds(ids);
  if (list.length === 0) return fail("Select at least one file first.");
  if (folderId !== null && !isUuid(folderId)) return fail("Invalid folder.");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media").update({ folder_id: folderId }).in("id", list).select("id");
    if (error) throw error;
    revalidateMedia();
    return okay(data?.length ?? 0, `${count(data?.length ?? 0, "file")} moved.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Trash
 * ────────────────────────────────────────────────────────────────────────── */

export async function trashMedia(ids: string[]): Promise<MediaResult<number>> {
  const list = cleanIds(ids);
  if (list.length === 0) return fail("Select at least one file first.");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media").update({ deleted_at: new Date().toISOString() }).in("id", list).is("deleted_at", null).select("id");
    if (error) throw error;
    const n = data?.length ?? 0;
    revalidateMedia();
    return okay(n, `${count(n, "file")} moved to the trash.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function restoreMedia(ids: string[]): Promise<MediaResult<number>> {
  const list = cleanIds(ids);
  if (list.length === 0) return fail("Select at least one file first.");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media").update({ deleted_at: null }).in("id", list).not("deleted_at", "is", null).select("id");
    if (error) throw error;
    const n = data?.length ?? 0;
    revalidateMedia();
    return okay(n, `${count(n, "file")} restored.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/** Permanent deletion – only for files that are already in the trash. */
export async function deleteMediaForever(ids: string[]): Promise<MediaResult<number>> {
  const list = cleanIds(ids);
  if (list.length === 0) return fail("Select at least one file first.");
  try {
    const { supabase } = await adminClient();
    const { data: rows, error } = await supabase.from("media").select("id, path, variants").in("id", list).not("deleted_at", "is", null);
    if (error) throw error;
    const victims = (rows ?? []) as Pick<MediaItem, "id" | "path" | "variants">[];
    if (victims.length === 0) return fail("Only files in the trash can be deleted permanently.");
    const victimIds = victims.map((v) => v.id);

    // products / settings lose the picture (the FKs set the *_media_id columns to null; the URLs would otherwise dangle)
    await repointReferences(supabase, victimIds, () => null);

    const { error: delError } = await supabase.from("media").delete().in("id", victimIds);
    if (delError) throw delError;
    await removeObjects(supabase, victims.flatMap(objectPathsOf));

    revalidateMedia(true);
    return okay(victims.length, `${count(victims.length, "file")} deleted permanently.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function emptyTrash(): Promise<MediaResult<number>> {
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media").select("id").not("deleted_at", "is", null).limit(1000);
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length === 0) return okay(0, "The trash is already empty.");
    let total = 0;
    for (let i = 0; i < ids.length; i += MAX_MEDIA_BULK) {
      const res = await deleteMediaForever(ids.slice(i, i + MAX_MEDIA_BULK));
      if (!res.ok) return res;
      total += res.data;
    }
    return okay(total, `Trash emptied – ${count(total, "file")} deleted permanently.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Replace (same URL) – browser uploads over the existing object, then we
 * re-inspect it and rebuild the generated sizes.
 * ────────────────────────────────────────────────────────────────────────── */

export async function prepareReplace(id: string, file: { name: string; size: number; type: string }): Promise<MediaResult<{ token: string; path: string }>> {
  if (!isUuid(id)) return fail("Invalid file.");
  try {
    const { supabase } = await adminClient();
    const item = await loadItem(supabase, id);
    if (!item) return fail("This file no longer exists.");
    if (item.deleted_at) return fail("Restore the file from the trash first.");
    const problem = validateMediaFile({ name: String(file.name ?? ""), size: Number(file.size), type: String(file.type ?? "") });
    if (problem) return fail(problem);
    const mime = mimeFor(String(file.name ?? ""), String(file.type ?? ""));
    if (mime !== item.mime_type) return fail(`Choose a file of the same type (${item.mime_type}) so the URL keeps working.`);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return fail("Your session has expired – please sign in again.");
    return okay({ token, path: item.path });
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function finalizeReplace(id: string): Promise<MediaResult<MediaItem>> {
  if (!isUuid(id)) return fail("Invalid file.");
  try {
    const { supabase } = await adminClient();
    const item = await loadItem(supabase, id);
    if (!item) return fail("This file no longer exists.");
    const { buffer } = await downloadObject(item.path);
    if (buffer.length > MAX_MEDIA_BYTES) return fail("The replacement is larger than 5 MB.");
    const info = item.kind === "image" ? await inspectImage(buffer) : { width: null, height: null, animated: false, format: null };
    const { variants, variants_size } = item.kind === "image" ? await generateVariants(supabase, buffer, item.mime_type, item.path, info) : { variants: {}, variants_size: 0 };
    // variants the new image no longer needs (e.g. smaller replacement)
    const stale = Object.values(item.variants ?? {}).map((v) => v!.path).filter((p) => !Object.values(variants).some((v) => v!.path === p));
    await removeObjects(supabase, stale);
    const { data, error } = await supabase
      .from("media")
      .update({ size: buffer.length, width: info.width, height: info.height, hash: sha256(buffer), variants, variants_size })
      .eq("id", id)
      .select(MEDIA_COLUMNS)
      .single();
    if (error) throw error;
    revalidateMedia(true);
    return okay(data as unknown as MediaItem, "File replaced – the URL is unchanged.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Optimise / convert / edit (images)
 * ────────────────────────────────────────────────────────────────────────── */

export type OptimizeOutcome = { item: MediaItem; before: number; after: number; skipped: boolean };

export async function optimizeMedia(id: string, options: OptimizeOptions): Promise<MediaResult<OptimizeOutcome>> {
  if (!isUuid(id)) return fail("Invalid file.");
  const format = options?.format === "webp" || options?.format === "avif" ? options.format : "keep";
  const quality = Number.isFinite(options?.quality) ? options.quality : 82;
  try {
    const { supabase } = await adminClient();
    const item = await loadItem(supabase, id);
    if (!item) return fail("This file no longer exists.");
    if (item.deleted_at) return fail("Restore the file from the trash first.");
    if (!isEditableImage(item.mime_type)) return fail(`${item.name} is not a JPEG, PNG, WebP, AVIF or GIF image.`);
    if (format === "keep" && item.mime_type === "image/gif") return fail("GIFs can only be converted, not re-compressed.");

    const { buffer } = await downloadObject(item.path);
    const out = await optimizeImageBuffer(buffer, item.mime_type, { format, quality });
    const converting = out.mime !== item.mime_type;
    if (!converting && out.buffer.length >= buffer.length) {
      return okay({ item, before: buffer.length, after: buffer.length, skipped: true }, `${item.name} is already as small as it gets.`);
    }

    const path = converting ? newObjectPath(item.name, out.ext) : item.path;
    await uploadObject(supabase, path, out.buffer, out.mime, !converting);
    const info = { width: out.width, height: out.height, animated: false, format: null };
    const { variants, variants_size } = await generateVariants(supabase, out.buffer, out.mime, path, info);

    const patch = {
      path,
      name: converting ? withExtension(item.name, out.ext) : item.name,
      mime_type: out.mime,
      size: out.buffer.length,
      width: out.width,
      height: out.height,
      hash: sha256(out.buffer),
      variants,
      variants_size,
    };
    const { data, error } = await supabase.from("media").update(patch).eq("id", id).select(MEDIA_COLUMNS).single();
    if (error) {
      if (converting) await removeObjects(supabase, [path, ...Object.values(variants).map((v) => v!.path)]);
      throw error;
    }
    if (converting) {
      await repointReferences(supabase, [id], () => mediaUrl(path));
      await removeObjects(supabase, objectPathsOf(item));
    } else {
      const stale = Object.values(item.variants ?? {}).map((v) => v!.path).filter((p) => !Object.values(variants).some((v) => v!.path === p));
      await removeObjects(supabase, stale);
    }
    revalidateMedia(true);
    return okay({ item: data as unknown as MediaItem, before: buffer.length, after: out.buffer.length, skipped: false });
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function editMedia(id: string, ops: EditOps, mode: "replace" | "copy"): Promise<MediaResult<MediaItem>> {
  if (!isUuid(id)) return fail("Invalid file.");
  const rotate = [0, 90, 180, 270].includes(Number(ops?.rotate)) ? (Number(ops.rotate) as EditOps["rotate"]) : 0;
  const crop =
    ops?.crop && [ops.crop.x, ops.crop.y, ops.crop.width, ops.crop.height].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
      ? { x: ops.crop.x, y: ops.crop.y, width: ops.crop.width, height: ops.crop.height }
      : null;
  const clean: EditOps = { rotate, flipH: Boolean(ops?.flipH), flipV: Boolean(ops?.flipV), crop };
  if (!clean.rotate && !clean.flipH && !clean.flipV && !clean.crop) return fail("Nothing to apply yet.");
  try {
    const { user, supabase } = await adminClient();
    const item = await loadItem(supabase, id);
    if (!item) return fail("This file no longer exists.");
    if (item.deleted_at) return fail("Restore the file from the trash first.");
    if (!isEditableImage(item.mime_type)) return fail("Only JPEG, PNG, WebP, AVIF and GIF images can be edited.");

    const { buffer } = await downloadObject(item.path);
    const out = await editImageBuffer(buffer, item.mime_type, clean);
    if (out.buffer.length > MAX_MEDIA_BYTES) return fail("The edited image would be larger than 5 MB.");
    const info = { width: out.width, height: out.height, animated: false, format: null };

    if (mode === "copy") {
      const path = newObjectPath(item.name);
      await uploadObject(supabase, path, out.buffer, item.mime_type);
      const { variants, variants_size } = await generateVariants(supabase, out.buffer, item.mime_type, path, info);
      const ext = extensionOf(item.name);
      const name = `${item.name.replace(/\.[a-z0-9]{1,8}$/i, "")}-edited${ext ? `.${ext}` : ""}`;
      const row = { folder_id: item.folder_id, name, path, mime_type: item.mime_type, kind: "image", size: out.buffer.length, width: out.width, height: out.height, alt: item.alt, hash: sha256(out.buffer), variants, variants_size, uploaded_by: user.id };
      const { data, error } = await supabase.from("media").insert(row).select(MEDIA_COLUMNS).single();
      if (error) {
        await removeObjects(supabase, [path, ...Object.values(variants).map((v) => v!.path)]);
        throw error;
      }
      revalidateMedia();
      return okay(data as unknown as MediaItem, `Saved as ${name}.`);
    }

    await uploadObject(supabase, item.path, out.buffer, item.mime_type, true);
    const { variants, variants_size } = await generateVariants(supabase, out.buffer, item.mime_type, item.path, info);
    const stale = Object.values(item.variants ?? {}).map((v) => v!.path).filter((p) => !Object.values(variants).some((v) => v!.path === p));
    await removeObjects(supabase, stale);
    const { data, error } = await supabase
      .from("media")
      .update({ size: out.buffer.length, width: out.width, height: out.height, hash: sha256(out.buffer), variants, variants_size })
      .eq("id", id)
      .select(MEDIA_COLUMNS)
      .single();
    if (error) throw error;
    revalidateMedia(true);
    return okay(data as unknown as MediaItem, "Image updated.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Folders
 * ────────────────────────────────────────────────────────────────────────── */

const folderName = (name: unknown) => String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);

export async function createMediaFolder(name: string): Promise<MediaResult<MediaFolder>> {
  const clean = folderName(name);
  if (!clean) return fail("Enter a folder name.");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media_folders").insert({ name: clean }).select("id, name, created_at").single();
    if (error) throw error;
    revalidateMedia();
    return okay(data as MediaFolder, `Folder "${clean}" created.`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function renameMediaFolder(id: string, name: string): Promise<MediaResult<MediaFolder>> {
  const clean = folderName(name);
  if (!isUuid(id)) return fail("Invalid folder.");
  if (!clean) return fail("Enter a folder name.");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("media_folders").update({ name: clean }).eq("id", id).select("id, name, created_at").single();
    if (error) throw error;
    revalidateMedia();
    return okay(data as MediaFolder, "Folder renamed.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/** Deletes the folder only – its files stay in the library (unfiled). */
export async function deleteMediaFolder(id: string): Promise<MediaResult<null>> {
  if (!isUuid(id)) return fail("Invalid folder.");
  try {
    const { supabase } = await adminClient();
    const { error } = await supabase.from("media_folders").delete().eq("id", id);
    if (error) throw error;
    revalidateMedia();
    return okay(null, "Folder deleted – its files are now unfiled.");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * AI alt text (optional – needs OPENAI_API_KEY)
 * ────────────────────────────────────────────────────────────────────────── */

export async function suggestAltText(id: string): Promise<MediaResult<string>> {
  if (!isUuid(id)) return fail("Invalid file.");
  try {
    const [{ supabase }, { server: aiSettings, client: aiClient }] = await Promise.all([
      adminClient(),
      loadAiSettingsForAction(),
    ]);
    const item = await loadItem(supabase, id);
    if (!item || item.kind !== "image") return fail("Alt text can only be generated for images.");

    const openAiKey = resolveProviderApiKey(aiSettings, "openai");
    const useOpenAiVision =
      Boolean(openAiKey) &&
      (aiSettings.provider === "openai" || !aiClient.is_ready || aiSettings.vision_enabled);

    if (useOpenAiVision && openAiKey) {
      const { buffer, contentType } = await downloadObject(
        item.variants.medium?.path ?? item.variants.large?.path ?? item.path,
      );
      const dataUrl = `data:${contentType.startsWith("image/") ? contentType : item.mime_type};base64,${buffer.toString("base64")}`;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${openAiKey}` },
        body: JSON.stringify({
          model:
            aiSettings.provider === "openai" && aiSettings.primary_model
              ? aiSettings.primary_model
              : process.env.OPENAI_ALT_TEXT_MODEL || "gpt-4o-mini",
          max_tokens: 80,
          messages: [
            {
              role: "system",
              content:
                "You write concise, descriptive alt text for e-commerce images. Reply with the alt text only – one sentence, no quotes, under 125 characters.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `File name: ${sanitizeFilename(item.name)}` },
                { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return fail(`The AI service answered ${res.status}. Check your OpenAI API key.`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "").slice(0, 300);
      if (!text) return fail("The AI service returned no text.");
      return okay(text);
    }

    if (!aiClient.is_ready || (aiSettings.provider === "ollama" && aiSettings.ollama_mode === "browser")) {
      return fail("Configure an AI provider in Settings → AI to generate alt text.");
    }

    const usageMap = await getMediaUsage([item.id]);
    const linked = (usageMap[item.id] ?? [])
      .map((u) => u.product_name)
      .filter((n): n is string => Boolean(n));

    const completion = await runModelCompletion({
      settings: aiSettings,
      preferWorkerModel: true,
      systemPrompt:
        "You write concise, descriptive SEO alt text for e-commerce and blog images. Reply with the alt text ONLY – one natural phrase or sentence, no quotes, under 120 characters.",
      messages: [
        {
          role: "user",
          content: `Image filename: ${sanitizeFilename(item.name)}${linked.length ? `\nUsed on: ${linked.join(", ")}` : ""}`,
        },
      ],
    });
    const text = completion.text.trim().replace(/^["']|["']$/g, "").slice(0, 200);
    if (!text) return fail("The AI service returned no text.");
    return okay(text);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Legacy buckets (product-images / site-media) → Media Library
 * ────────────────────────────────────────────────────────────────────────── */

export type LegacyStatus = { buckets: LegacyBucketStatus[] };

/** Which legacy buckets are still around and what is inside them. */
export async function legacyMediaStatus(): Promise<MediaResult<LegacyStatus>> {
  try {
    const { supabase } = await adminClient();
    const buckets = await Promise.all(LEGACY_BUCKETS.map((b) => legacyBucketStatus(supabase, b)));
    return okay({ buckets: buckets.filter((b) => b.exists || b.objects.length > 0) });
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export type LegacyImportResult = { item: MediaItem; reused: boolean; products: number; settings: number };

/**
 * Moves one legacy object into the library: downloads it, registers it like a
 * fresh upload (same-bytes files are reused instead of duplicated), points the
 * products / settings that used the old URL at the new file and deletes the
 * old object.
 */
export async function importLegacyObject(bucket: string, path: string): Promise<MediaResult<LegacyImportResult>> {
  if (!isLegacyBucket(bucket)) return fail("Unknown bucket.");
  const clean = String(path ?? "").trim();
  if (!clean || clean.length > 500 || clean.includes("..") || clean.startsWith("/")) return fail("Invalid object path.");
  try {
    const { user, supabase } = await adminClient();
    const oldUrl = legacyPublicUrl(bucket, clean);
    const name = legacyDisplayName(clean);

    const res = await fetch(`${oldUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return fail(`${name}: the file could not be read from the ${bucket} bucket (${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = mimeFor(name, res.headers.get("content-type") ?? "");
    const problem = validateMediaFile({ name, size: buffer.length, type: mime });
    if (problem) return fail(problem);

    // same bytes already in the library? reuse that row instead of storing a copy
    const hash = sha256(buffer);
    const { data: twin } = await supabase.from("media").select(MEDIA_COLUMNS).eq("hash", hash).is("deleted_at", null).limit(1).maybeSingle();
    let item = (twin as unknown as MediaItem | null) ?? null;
    const reused = Boolean(item);
    if (!item) {
      const newPath = newObjectPath(name);
      await uploadObject(supabase, newPath, buffer, mime);
      const folderId = bucket === "site-media" ? await folderIdByName(supabase, BRANDING_FOLDER) : null;
      item = await storeMediaRow(supabase, user.id, { path: newPath, name, mime, buffer, folderId });
    }
    const newUrl = mediaUrl(item.path);

    // repoint everything that rendered the old URL
    const { data: products, error: productError } = await supabase.from("products").update({ image_url: newUrl, image_media_id: item.id }).eq("image_url", oldUrl).select("id");
    if (productError) throw productError;
    let settings = 0;
    const { data: row } = await supabase.from("site_settings").select("favicon_url, seo_og_image_url").eq("id", 1).maybeSingle();
    const current = (row ?? {}) as { favicon_url?: string | null; seo_og_image_url?: string | null };
    const patch: Record<string, string> = {};
    if (current.favicon_url === oldUrl) Object.assign(patch, { favicon_url: newUrl, favicon_media_id: item.id });
    if (current.seo_og_image_url === oldUrl) Object.assign(patch, { seo_og_image_url: newUrl, seo_og_image_media_id: item.id });
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("site_settings").update(patch).eq("id", 1);
      if (error) throw error;
      settings = Object.keys(patch).length / 2;
      updateTag(SITE_SETTINGS_TAG);
    }

    const { error: removeError } = await supabase.storage.from(bucket).remove([clean]);
    if (removeError) console.error(`[media] legacy object ${bucket}/${clean} could not be removed: ${removeError.message}`);

    revalidateMedia(true);
    return okay({ item, reused, products: products?.length ?? 0, settings });
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export type LegacyCleanupResult = { removed: LegacyBucket[]; remaining: { id: LegacyBucket; reason: string }[] };

/** Deletes the legacy buckets that are empty by now; reports the ones that are not. */
export async function removeLegacyBuckets(): Promise<MediaResult<LegacyCleanupResult>> {
  try {
    const { supabase } = await adminClient();
    const result: LegacyCleanupResult = { removed: [], remaining: [] };
    for (const id of LEGACY_BUCKETS) {
      const status = await legacyBucketStatus(supabase, id);
      if (!status.exists && status.objects.length === 0) continue; // already gone
      if (status.objects.length) {
        result.remaining.push({ id, reason: `still holds ${count(status.objects.length, "file")}` });
        continue;
      }
      const { error } = await supabase.storage.deleteBucket(id);
      if (error) result.remaining.push({ id, reason: `could not be deleted from here (${error.message}) – remove it in the Supabase dashboard under Storage → Buckets` });
      else result.removed.push(id);
    }
    revalidateMedia();
    return okay(result);
  } catch (e) {
    return fail(friendlyError(e));
  }
}
