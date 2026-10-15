import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ──────────────────────────────────────────────────────────────────────────
 * Buckets
 *  - product-images: legacy catalogue photos (uploaded before the Media Library;
 *                    still cleaned up when a product drops / replaces one)
 *  - media:          the Media Library (see src/lib/media) – new product images live here
 *  - site-media:     branding & "other" media – favicon, social share image …
 *                    (never mixed with product photos)
 * Limits/mime lists mirror the bucket definitions in supabase/migrations.
 * ────────────────────────────────────────────────────────────────────────── */

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const SITE_MEDIA_BUCKET = "site-media";

export const MAX_SITE_MEDIA_BYTES = 2 * 1024 * 1024; // site-media file_size_limit

/** Favicons: everything browsers accept for <link rel="icon">. */
export const ALLOWED_FAVICON_TYPES: Record<string, string> = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

/** Social share images: raster only (crawlers do not render SVG). */
export const ALLOWED_SHARE_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function publicPrefix(bucket: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/`;
}

/** Object path inside `bucket` when `url` is one of *our* uploads, otherwise null. */
export function storagePathFromUrl(url: string | null | undefined, bucket: string = PRODUCT_IMAGE_BUCKET): string | null {
  if (!url) return null;
  const prefix = publicPrefix(bucket);
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length).split("?")[0];
  try {
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

/**
 * Browsers report `.ico` files inconsistently (`image/x-icon`,
 * `image/vnd.microsoft.icon` or even an empty type) – fall back to the extension.
 */
function faviconType(file: File): string | null {
  if (ALLOWED_FAVICON_TYPES[file.type]) return file.type;
  if (/\.ico$/i.test(file.name)) return "image/x-icon";
  if (/\.svg$/i.test(file.name)) return "image/svg+xml";
  return null;
}

export function validateFaviconFile(file: File): string | null {
  if (!faviconType(file)) return "Please upload an ICO, PNG, SVG or WebP icon.";
  if (file.size > MAX_SITE_MEDIA_BYTES) return "Icons must be 2 MB or smaller.";
  return null;
}

export function validateShareImageFile(file: File): string | null {
  if (!ALLOWED_SHARE_IMAGE_TYPES[file.type]) return "Please upload a JPEG, PNG, WebP or GIF image.";
  if (file.size > MAX_SITE_MEDIA_BYTES) return "Share images must be 2 MB or smaller.";
  return null;
}

async function uploadTo(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  file: File,
  contentType: string,
  label: string,
): Promise<{ url: string; path: string }> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, await file.arrayBuffer(), { contentType, cacheControl: "31536000", upsert: false });

  if (error) throw new Error(`${label} upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

const uniqueSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Uploads a branding file (favicon, share image, …) to the `site-media` bucket
 * under `branding/<kind>-<unique>.<ext>` and returns its public URL + path.
 */
export async function uploadSiteMedia(
  supabase: SupabaseClient,
  file: File,
  kind: "favicon" | "share-image",
): Promise<{ url: string; path: string }> {
  const contentType = (kind === "favicon" ? faviconType(file) : ALLOWED_SHARE_IMAGE_TYPES[file.type] && file.type) || "application/octet-stream";
  const ext = (kind === "favicon" ? ALLOWED_FAVICON_TYPES[contentType] : ALLOWED_SHARE_IMAGE_TYPES[contentType]) ?? "bin";
  return uploadTo(supabase, SITE_MEDIA_BUCKET, `branding/${kind}-${uniqueSuffix()}.${ext}`, file, contentType, kind === "favicon" ? "Favicon" : "Share image");
}

/**
 * Deletes the object behind `url` if it lives in `bucket` (custom/external
 * URLs are left alone). Failures are logged, never thrown – a dangling file is
 * better than a failed save.
 */
async function removeIfOwned(supabase: SupabaseClient, bucket: string, url: string | null | undefined) {
  const path = storagePathFromUrl(url, bucket);
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.error(`[storage] could not remove ${bucket}/${path}: ${error.message}`);
}

export const removeProductImageIfOwned = (supabase: SupabaseClient, url: string | null | undefined) =>
  removeIfOwned(supabase, PRODUCT_IMAGE_BUCKET, url);

export const removeSiteMediaIfOwned = (supabase: SupabaseClient, url: string | null | undefined) =>
  removeIfOwned(supabase, SITE_MEDIA_BUCKET, url);

/** Batch version of `removeProductImageIfOwned` for bulk deletes – skips nulls, never throws. */
export async function removeProductImages(supabase: SupabaseClient, paths: Array<string | null>) {
  const owned = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (owned.length === 0) return;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(owned);
  if (error) console.error(`[storage] could not remove ${owned.length} image(s): ${error.message}`);
}
