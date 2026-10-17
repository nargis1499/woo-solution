import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type sharpType from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

let sharpCached: typeof sharpType | null | undefined;
async function getSharp(): Promise<typeof sharpType | null> {
  if (sharpCached !== undefined) return sharpCached;
  try {
    const mod = await import("sharp");
    sharpCached = mod.default ?? (mod as unknown as typeof sharpType);
  } catch {
    sharpCached = null;
  }
  return sharpCached;
}
import { requireAdmin } from "@/lib/admin/auth";
import { pageCount } from "@/lib/admin/pagination";
import { createClient } from "@/lib/supabase/server";
import type { MediaFolder, MediaItem, MediaUsage, MediaVariant, MediaVariantName } from "@/lib/types";
import {
  IMAGE_MIME_EXT,
  MEDIA_BUCKET,
  MEDIA_SIZE_PRESETS,
  extensionOf,
  mediaUrl,
  sanitizeFilename,
  type MediaListParams,
  type EditOps,
  type MediaPage,
  type MediaTotals,
  type OptimizeOptions,
} from "./shared";

/* ──────────────────────────────────────────────────────────────────────────
 * Queries
 * ────────────────────────────────────────────────────────────────────────── */

export const MEDIA_COLUMNS =
  "id, folder_id, name, path, mime_type, kind, size, width, height, alt, hash, variants, variants_size, uploaded_by, deleted_at, created_at, updated_at";


const escapeLike = (value: string) => value.replace(/[%_\\]/g, (m) => `\\${m}`);

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** One page of the library (or of the trash) for the validated list params. */
export async function listMedia(params: MediaListParams): Promise<MediaPage> {
  await requireAdmin();
  const supabase = await createClient();
  const preset = MEDIA_SIZE_PRESETS.find((p) => p.id === params.size);

  const build = (columns: string, head: boolean) => {
    let q = supabase.from("media").select(columns, { count: "exact", head });
    q = params.trash ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    if (params.q) q = q.ilike("name", `%${escapeLike(params.q)}%`);
    if (params.kind) q = q.eq("kind", params.kind);
    if (params.folder === "none") q = q.is("folder_id", null);
    else if (params.folder) q = q.eq("folder_id", params.folder);
    if (params.from) q = q.gte("created_at", `${params.from}T00:00:00.000Z`);
    if (params.to) q = q.lt("created_at", nextDay(params.to));
    if (preset?.min != null) q = q.gte("size", preset.min);
    if (preset?.max != null) q = q.lt("size", preset.max);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to count media: ${countError.message}`);
  const total = count ?? 0;
  const perPage = params.per;
  const page = Math.min(Math.max(1, params.page), pageCount(total, perPage));
  const from = (page - 1) * perPage;

  const [col, dir] = params.sort.split("_") as ["date" | "name" | "size" | "type", "asc" | "desc"];
  const ascending = dir === "asc";
  let q = build(MEDIA_COLUMNS, false);
  if (col === "date") q = q.order(params.trash ? "deleted_at" : "created_at", { ascending });
  else if (col === "name") q = q.order("name", { ascending });
  else if (col === "size") q = q.order("size", { ascending });
  else q = q.order("mime_type", { ascending }).order("name", { ascending: true });
  q = q.order("id", { ascending: false }); // stable order for identical values

  const { data, error } = await q.range(from, from + perPage - 1);
  if (error) throw new Error(`Failed to load media: ${error.message}`);
  return { items: (data ?? []) as unknown as MediaItem[], total, page, perPage };
}

export async function getMediaItem(id: string): Promise<MediaItem | null> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("media").select(MEDIA_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load file: ${error.message}`);
  return (data as unknown as MediaItem) ?? null;
}

export async function listMediaFolders(): Promise<MediaFolder[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_folders")
    .select("id, name, created_at, media(count)")
    .is("media.deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load folders: ${error.message}`);
  return ((data ?? []) as unknown as (MediaFolder & { media?: { count: number }[] })[]).map(({ media, ...folder }) => ({
    ...folder,
    file_count: media?.[0]?.count ?? 0,
  }));
}


export async function getMediaTotals(): Promise<MediaTotals> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("media_totals").single();
  if (error) throw new Error(`Failed to load storage totals: ${error.message}`);
  const row = data as Record<string, number | string>;
  return {
    library_count: Number(row.library_count ?? 0),
    library_bytes: Number(row.library_bytes ?? 0),
    trash_count: Number(row.trash_count ?? 0),
    trash_bytes: Number(row.trash_bytes ?? 0),
  };
}

/** Usage rows for a set of files, grouped by file id. */
export async function getMediaUsage(ids: string[]): Promise<Record<string, MediaUsage[]>> {
  const out: Record<string, MediaUsage[]> = {};
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("media_usage", { p_ids: ids });
  if (error) throw new Error(`Failed to load usage: ${error.message}`);
  for (const row of (data ?? []) as MediaUsage[]) (out[row.media_id] ??= []).push(row);
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Storage
 * ────────────────────────────────────────────────────────────────────────── */

/** `2026/10/my-photo-3f2a9c.png` – readable, unique, never collides with a rename. */
export function newObjectPath(originalName: string, ext = extensionOf(originalName)): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = sanitizeFilename(originalName).replace(/\.[a-z0-9]+$/i, "");
  return `${yyyy}/${mm}/${base}-${randomBytes(3).toString("hex")}${ext ? `.${ext}` : ""}`;
}

export function variantPath(path: string, name: MediaVariantName): string {
  return `${path.replace(/\.[a-z0-9]+$/i, "")}-${name}.webp`;
}

export async function uploadObject(supabase: SupabaseClient, path: string, body: Buffer, contentType: string, upsert = false): Promise<void> {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, { contentType, cacheControl: "31536000", upsert });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

/** Never throws – a dangling object is better than a failed action. */
export async function removeObjects(supabase: SupabaseClient, paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(unique);
  if (error) console.error(`[media] could not remove ${unique.length} object(s): ${error.message}`);
}

/** Downloads an object (public bucket → plain fetch, no auth round-trip). */
export async function downloadObject(path: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(`${mediaUrl(path)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`The file could not be read from storage (${res.status}).`);
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

export const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Every object that belongs to a library row (original + generated sizes). */
export function objectPathsOf(item: Pick<MediaItem, "path" | "variants">): string[] {
  return [item.path, ...Object.values(item.variants ?? {}).map((v) => v!.path)];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Images
 * ────────────────────────────────────────────────────────────────────────── */

const VARIANT_SIZES: Record<MediaVariantName, number> = { thumbnail: 320, medium: 768, large: 1600 };
const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/tiff", "image/bmp"]);

export type ImageInfo = { width: number | null; height: number | null; animated: boolean; format: string | null };

export async function inspectImage(buffer: Buffer): Promise<ImageInfo> {
  try {
    const sharp = await getSharp();
    if (!sharp) return { width: null, height: null, animated: false, format: null };
    const meta = await sharp(buffer, { animated: false }).metadata();
    const swap = (meta.orientation ?? 1) >= 5; // EXIF rotated by 90°
    return {
      width: (swap ? meta.height : meta.width) ?? null,
      height: (swap ? meta.width : meta.height) ?? null,
      animated: (meta.pages ?? 1) > 1,
      format: meta.format ?? null,
    };
  } catch {
    return { width: null, height: null, animated: false, format: null };
  }
}

/**
 * Generates the thumbnail / medium / large WebP renditions for a raster image
 * and uploads them next to the original. Sizes the source is already smaller
 * than are skipped (the original is used instead).
 */
export async function generateVariants(
  supabase: SupabaseClient,
  buffer: Buffer,
  mime: string,
  path: string,
  info: ImageInfo,
): Promise<{ variants: Partial<Record<MediaVariantName, MediaVariant>>; variants_size: number }> {
  const variants: Partial<Record<MediaVariantName, MediaVariant>> = {};
  let total = 0;
  if (!RASTER.has(mime) || !info.width || !info.height) return { variants, variants_size: 0 };
  const sharp = await getSharp();
  if (!sharp) return { variants, variants_size: 0 };
  const longest = Math.max(info.width, info.height);
  for (const [name, target] of Object.entries(VARIANT_SIZES) as [MediaVariantName, number][]) {
    // always a thumbnail (fast grids), larger renditions only when they would actually be smaller
    if (name !== "thumbnail" && longest <= target) continue;
    if (name !== "thumbnail" && info.animated) continue; // keep animations intact – only the still thumbnail
    try {
      const out = await sharp(buffer, { animated: false })
        .rotate()
        .resize({ width: target, height: target, fit: "inside", withoutEnlargement: true })
        .webp({ quality: name === "thumbnail" ? 75 : 82 })
        .toBuffer({ resolveWithObject: true });
      const vPath = variantPath(path, name);
      await uploadObject(supabase, vPath, out.data, "image/webp", true);
      variants[name] = { path: vPath, width: out.info.width, height: out.info.height, size: out.data.length };
      total += out.data.length;
    } catch (e) {
      console.error(`[media] variant ${name} for ${path} failed:`, e);
    }
  }
  return { variants, variants_size: total };
}


/** Re-encodes an image (same format = optimise, webp/avif = convert). */
export async function optimizeImageBuffer(
  buffer: Buffer,
  mime: string,
  { format, quality }: OptimizeOptions,
): Promise<{ buffer: Buffer; mime: string; ext: string; width: number; height: number }> {
  const sharp = await getSharp();
  if (!sharp) throw new Error("Image optimisation requires the Node.js runtime with sharp.");
  const q = Math.min(100, Math.max(30, Math.round(quality)));
  const info = await inspectImage(buffer);
  let img = sharp(buffer, { animated: info.animated && format !== "avif" }).rotate();
  let outMime = mime;
  if (format === "webp") {
    img = img.webp({ quality: q, effort: 4 });
    outMime = "image/webp";
  } else if (format === "avif") {
    img = img.avif({ quality: Math.min(90, Math.max(30, q - 20)), effort: 4 });
    outMime = "image/avif";
  } else if (mime === "image/jpeg") img = img.jpeg({ quality: q, mozjpeg: true });
  else if (mime === "image/png") img = img.png({ compressionLevel: 9, effort: 8, palette: false });
  else if (mime === "image/webp") img = img.webp({ quality: q, effort: 4 });
  else if (mime === "image/avif") img = img.avif({ quality: Math.min(90, Math.max(30, q - 20)), effort: 4 });
  else if (mime === "image/gif") img = img.gif({ effort: 7 });
  else throw new Error("This image format can't be optimised.");
  const out = await img.toBuffer({ resolveWithObject: true });
  return { buffer: out.data, mime: outMime, ext: IMAGE_MIME_EXT[outMime] ?? extensionOf(outMime), width: out.info.width, height: out.info.height };
}

/** Rotate → flip → crop, encoded back into the same format. */
export async function editImageBuffer(buffer: Buffer, mime: string, ops: EditOps): Promise<{ buffer: Buffer; width: number; height: number }> {
  const sharp = await getSharp();
  if (!sharp) throw new Error("Image editing requires the Node.js runtime with sharp.");
  const info = await inspectImage(buffer);
  if (info.animated) throw new Error("Animated images can't be edited.");
  // sharp pipeline: flips always run before the rotation, and an extract() chained *after*
  // rotate() crops the rotated result – exactly the order the editor's preview uses.
  let img = sharp(buffer).rotate(); // bake EXIF orientation first
  if (ops.flipH) img = img.flop();
  if (ops.flipV) img = img.flip();
  if (ops.rotate) img = img.rotate(ops.rotate);
  if (ops.crop) {
    const rotated = ops.rotate === 90 || ops.rotate === 270;
    const w = (rotated ? info.height : info.width) ?? 0;
    const h = (rotated ? info.width : info.height) ?? 0;
    const left = Math.max(0, Math.round((ops.crop.x / 100) * w));
    const top = Math.max(0, Math.round((ops.crop.y / 100) * h));
    const width = Math.min(w - left, Math.max(1, Math.round((ops.crop.width / 100) * w)));
    const height = Math.min(h - top, Math.max(1, Math.round((ops.crop.height / 100) * h)));
    if (width < 1 || height < 1) throw new Error("The crop area is empty.");
    img = img.extract({ left, top, width, height });
  }
  if (mime === "image/jpeg") img = img.jpeg({ quality: 90, mozjpeg: true });
  else if (mime === "image/png") img = img.png({ compressionLevel: 9 });
  else if (mime === "image/webp") img = img.webp({ quality: 90 });
  else if (mime === "image/avif") img = img.avif({ quality: 65 });
  else if (mime === "image/gif") img = img.gif();
  else throw new Error("This image format can't be edited.");
  const out = await img.toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}
