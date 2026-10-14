import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // keep in sync with the bucket's file_size_limit
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function publicPrefix(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
}

/** Object path inside our bucket when `url` is one of *our* uploads, otherwise null. */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = publicPrefix();
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length).split("?")[0];
  try {
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES[file.type]) return "Please upload a JPEG, PNG, WebP, GIF or AVIF image.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

/** Uploads a product image and returns its public URL + object path. */
export async function uploadProductImage(
  supabase: SupabaseClient,
  file: File,
  slug: string,
): Promise<{ url: string; path: string }> {
  const ext = ALLOWED_IMAGE_TYPES[file.type] ?? "bin";
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "").slice(0, 60) || "product";
  const path = `products/${safeSlug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, cacheControl: "31536000", upsert: false });

  if (error) throw new Error(`Image upload failed: ${error.message}`);

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Deletes the object behind `url` if it lives in our bucket (custom/external
 * URLs are left alone). Failures are logged, never thrown – a dangling file is
 * better than a failed save.
 */
export async function removeProductImageIfOwned(supabase: SupabaseClient, url: string | null | undefined) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
  if (error) console.error(`[storage] could not remove ${path}: ${error.message}`);
}
