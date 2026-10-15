import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ──────────────────────────────────────────────────────────────────────────
 * Legacy Storage buckets
 *
 * Before the Media Library, product photos went to `product-images` and the
 * branding files (favicon, share image) to `site-media`. Everything lives in
 * the single `media` bucket now; these helpers power the one-off importer on
 * /nemesis/media that moves the old files over and removes the buckets.
 * ────────────────────────────────────────────────────────────────────────── */

export const LEGACY_BUCKETS = ["product-images", "site-media"] as const;
export type LegacyBucket = (typeof LEGACY_BUCKETS)[number];

export type LegacyObject = { bucket: LegacyBucket; path: string; size: number; mime: string | null };
export type LegacyBucketStatus = {
  id: LegacyBucket;
  /** The bucket row is visible through the Storage API (needed to delete it from the app). */
  exists: boolean;
  objects: LegacyObject[];
};

export const isLegacyBucket = (value: unknown): value is LegacyBucket => LEGACY_BUCKETS.includes(value as LegacyBucket);

export function legacyPublicUrl(bucket: LegacyBucket, path: string): string {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}

/** `products/everyday-hoodie-lx3k9f-a1b2c3.jpg` → `everyday-hoodie.jpg`, `branding/favicon-….png` → `favicon.png` */
export function legacyDisplayName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/-[a-z0-9]{6,12}-[a-z0-9]{6}(\.[a-z0-9]{1,8})$/i, "$1");
}

/** Lists every object in a bucket (the Storage API lists one folder level at a time). */
export async function listLegacyObjects(supabase: SupabaseClient, bucket: LegacyBucket): Promise<LegacyObject[]> {
  const out: LegacyObject[] = [];
  const walk = async (prefix: string, depth: number) => {
    if (depth > 4) return;
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.id) {
        await walk(path, depth + 1); // folders come back without an id
        continue;
      }
      const meta = (entry.metadata ?? {}) as { size?: number; mimetype?: string };
      out.push({ bucket, path, size: Number(meta.size ?? 0), mime: meta.mimetype ?? null });
    }
  };
  await walk("", 0);
  return out;
}

export async function legacyBucketStatus(supabase: SupabaseClient, bucket: LegacyBucket): Promise<LegacyBucketStatus> {
  const [{ data: row }, objects] = await Promise.all([
    supabase.storage.getBucket(bucket),
    listLegacyObjects(supabase, bucket).catch(() => [] as LegacyObject[]),
  ]);
  return { id: bucket, exists: Boolean(row), objects };
}
