import { zipSync, type Zippable } from "fflate";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_COLUMNS, downloadObject } from "@/lib/media/server";
import { isUuid } from "@/lib/media/shared";
import type { MediaItem } from "@/lib/types";

/**
 * GET /nemesis/media/download?id=<uuid>           → the file itself (attachment, display name)
 * GET /nemesis/media/download?ids=<uuid>,<uuid>…  → one zip with every selected file
 *
 * Admin-only. Objects are public anyway – this just forces a download with the
 * library's display names instead of the storage keys, and bundles bulk picks.
 */
const MAX_ZIP_FILES = 100;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

const ascii = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
const disposition = (name: string) => `attachment; filename="${ascii(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(request: Request) {
  try {
    await assertAdmin();
  } catch (e) {
    const status = e instanceof AdminAuthError ? 403 : 500;
    return new Response(status === 403 ? "Forbidden" : "Error", { status });
  }

  const url = new URL(request.url);
  const single = url.searchParams.get("id");
  const ids = [...new Set((single ? [single] : (url.searchParams.get("ids") ?? "").split(",")).map((s) => s.trim()).filter(isUuid))];
  if (ids.length === 0) return new Response("No files selected.", { status: 400 });
  if (ids.length > MAX_ZIP_FILES) return new Response(`Download at most ${MAX_ZIP_FILES} files at once.`, { status: 413 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("media").select(MEDIA_COLUMNS).in("id", ids);
  if (error) return new Response(error.message, { status: 500 });
  const items = (data ?? []) as unknown as MediaItem[];
  if (items.length === 0) return new Response("Not found.", { status: 404 });
  if (items.reduce((sum, i) => sum + i.size, 0) > MAX_ZIP_BYTES) return new Response("That selection is too large for one download.", { status: 413 });

  if (items.length === 1 && single) {
    const item = items[0];
    const { buffer } = await downloadObject(item.path);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": item.mime_type || "application/octet-stream",
        "content-length": String(buffer.length),
        "content-disposition": disposition(item.name),
        "cache-control": "private, no-store",
      },
    });
  }

  // duplicate display names get a counter so nothing is silently overwritten inside the zip
  const used = new Map<string, number>();
  const entries: Zippable = {};
  for (const item of items) {
    const { buffer } = await downloadObject(item.path);
    const n = used.get(item.name) ?? 0;
    used.set(item.name, n + 1);
    const name = n === 0 ? item.name : item.name.replace(/(\.[a-z0-9]{1,8})?$/i, ` (${n})$1`);
    // images / video / archives are already compressed – storing them is faster and just as small
    const level = /^(image|video|audio)\//.test(item.mime_type) || /zip|compressed|7z|rar/.test(item.mime_type) ? 0 : 6;
    entries[name] = [new Uint8Array(buffer), { level: level as 0 | 6 }];
  }
  const zip = zipSync(entries);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-length": String(zip.length),
      "content-disposition": disposition(`media-${stamp}.zip`),
      "cache-control": "private, no-store",
    },
  });
}
