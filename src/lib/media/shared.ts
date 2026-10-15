/**
 * Media library helpers shared by server code, Server Actions and client
 * components (no `server-only` import on purpose).
 *
 * URL contract for /nemesis/media:
 *   ?q=        file-name search            ?kind=image|video|document|other
 *   ?folder=   folder id | "none"          ?from= / ?to=   upload date (YYYY-MM-DD)
 *   ?size=     s | m | l (size preset)     ?sort=  date_desc (default) | date_asc | name_asc | name_desc | size_desc | size_asc | type_asc | type_desc
 *   ?per=      12 | 24 | 48 | 96           ?page=  1-based
 *   ?view=     grid | list                 ?trash=1  show the trash instead of the library
 */

import type { MediaItem, MediaKind, MediaRef, MediaVariantName, Product } from "@/lib/types";

export const MEDIA_BUCKET = "media";
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_BYTES_LABEL = "5 MB";

export const MEDIA_PAGE_SIZES = [12, 24, 48, 96] as const;
export const DEFAULT_MEDIA_PER_PAGE: (typeof MEDIA_PAGE_SIZES)[number] = 24;
export const MEDIA_PER_PAGE_COOKIE = "admin_media_per_page";
export const MEDIA_VIEW_COOKIE = "admin_media_view";

/** Hard cap for one bulk action (ids per request). */
export const MAX_MEDIA_BULK = 200;
/** Gallery images per product. */
export const MAX_PRODUCT_GALLERY = 20;

export type MediaView = "grid" | "list";
export type MediaSort = "date_desc" | "date_asc" | "name_asc" | "name_desc" | "size_desc" | "size_asc" | "type_asc" | "type_desc";
export type MediaSizePreset = "" | "s" | "m" | "l";

export const MEDIA_SORTS: { id: MediaSort; label: string }[] = [
  { id: "date_desc", label: "Newest first" },
  { id: "date_asc", label: "Oldest first" },
  { id: "name_asc", label: "Name A–Z" },
  { id: "name_desc", label: "Name Z–A" },
  { id: "size_desc", label: "Largest first" },
  { id: "size_asc", label: "Smallest first" },
  { id: "type_asc", label: "Type A–Z" },
  { id: "type_desc", label: "Type Z–A" },
];

export const MEDIA_KINDS: { id: MediaKind; label: string }[] = [
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "document", label: "Documents" },
  { id: "other", label: "Other" },
];

export const MEDIA_SIZE_PRESETS: { id: MediaSizePreset; label: string; min?: number; max?: number }[] = [
  { id: "", label: "Any size" },
  { id: "s", label: "Under 100 KB", max: 100 * 1024 },
  { id: "m", label: "100 KB – 1 MB", min: 100 * 1024, max: 1024 * 1024 },
  { id: "l", label: "Over 1 MB", min: 1024 * 1024 },
];

export type MediaListParams = {
  q: string;
  kind: MediaKind | "";
  folder: string; // "" = all, "none" = not in a folder, otherwise a folder id
  from: string; // YYYY-MM-DD
  to: string;
  size: MediaSizePreset;
  sort: MediaSort;
  per: number;
  page: number;
  view: MediaView;
  trash: boolean;
};

export const MEDIA_LIST_DEFAULTS: MediaListParams = {
  q: "",
  kind: "",
  folder: "",
  from: "",
  to: "",
  size: "",
  sort: "date_desc",
  per: DEFAULT_MEDIA_PER_PAGE,
  page: 1,
  view: "grid",
  trash: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isSort = (v: unknown): v is MediaSort => MEDIA_SORTS.some((s) => s.id === v);
const isKind = (v: unknown): v is MediaKind => MEDIA_KINDS.some((k) => k.id === v);
const isPreset = (v: unknown): v is MediaSizePreset => MEDIA_SIZE_PRESETS.some((p) => p.id === v);

export function parseMediaPerPage(value: unknown, fallback: number = DEFAULT_MEDIA_PER_PAGE): number {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return (MEDIA_PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/** Validated list params from raw search params; unknown values fall back to the defaults. */
export function parseMediaParams(
  raw: Record<string, string | string[] | undefined>,
  fallbacks: { per?: number; view?: MediaView } = {},
): MediaListParams {
  const get = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const folderRaw = get("folder");
  const page = Math.floor(Number(get("page")));
  const view = get("view");
  return {
    q: get("q").trim().slice(0, 120),
    kind: isKind(get("kind")) ? (get("kind") as MediaKind) : "",
    folder: folderRaw === "none" || isUuid(folderRaw) ? folderRaw : "",
    from: DATE_RE.test(get("from")) ? get("from") : "",
    to: DATE_RE.test(get("to")) ? get("to") : "",
    size: isPreset(get("size")) ? (get("size") as MediaSizePreset) : "",
    sort: isSort(get("sort")) ? (get("sort") as MediaSort) : "date_desc",
    per: parseMediaPerPage(get("per"), fallbacks.per ?? DEFAULT_MEDIA_PER_PAGE),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    view: view === "list" || view === "grid" ? view : (fallbacks.view ?? "grid"),
    trash: get("trash") === "1",
  };
}

/** `/nemesis/media?…` for a set of params (defaults are omitted, `per` is always explicit). */
export function mediaHref(params: Partial<MediaListParams>, pathname = "/nemesis/media"): string {
  const p = { ...MEDIA_LIST_DEFAULTS, ...params };
  const sp = new URLSearchParams();
  if (p.trash) sp.set("trash", "1");
  if (p.q) sp.set("q", p.q);
  if (p.kind) sp.set("kind", p.kind);
  if (p.folder) sp.set("folder", p.folder);
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  if (p.size) sp.set("size", p.size);
  if (p.sort !== "date_desc") sp.set("sort", p.sort);
  if (p.view !== "grid") sp.set("view", p.view);
  sp.set("per", String(p.per));
  if (p.page > 1) sp.set("page", String(p.page));
  const query = sp.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/* ─── URLs ────────────────────────────────────────────────────────────────── */

const publicPrefix = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/`;

/** Public URL of an object in the media bucket (this is the URL the admin copies / the storefront renders). */
export function mediaUrl(path: string): string {
  return publicPrefix() + path.split("/").map(encodeURIComponent).join("/");
}

/** Object path when `url` points into the media bucket, otherwise null. */
export function mediaPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = publicPrefix();
  if (!url.startsWith(prefix)) return null;
  try {
    const path = decodeURIComponent(url.slice(prefix.length).split("?")[0]);
    return path || null;
  } catch {
    return null;
  }
}

/** Best URL for a small preview: thumbnail variant → original image → null (non-images show an icon). */
export function mediaPreviewUrl(item: Pick<MediaItem, "kind" | "path" | "variants" | "mime_type" | "updated_at">, prefer: MediaVariantName = "thumbnail"): string | null {
  if (item.kind !== "image") return null;
  // A missing rendition means the original is already that small (renditions are never upscaled),
  // so fall back to the original rather than to a *bigger* rendition – except for thumbnails,
  // where any rendition beats the full-size file in a grid.
  const v = item.variants?.[prefer] ?? (prefer === "thumbnail" ? (item.variants?.medium ?? item.variants?.large) : undefined);
  // `?v=` busts caches after replace / edit – the canonical URL itself never changes
  return `${mediaUrl(v?.path ?? item.path)}?v=${encodeURIComponent(item.updated_at)}`;
}

/* ─── Types / names ───────────────────────────────────────────────────────── */

const DOC_MIME = /^(application\/(pdf|msword|rtf|epub\+zip|vnd\.(ms-excel|ms-powerpoint|openxmlformats-officedocument\.[a-z.]+|oasis\.opendocument\.[a-z]+))|text\/)/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|odt|ods|odp|epub)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|ico|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i;

export function mediaKindFor(mime: string, name: string): MediaKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  if (DOC_MIME.test(m) || DOC_EXT.test(name)) return "document";
  return "other";
}

/** Active content is never accepted – a public bucket would serve it as a page / script. */
const BLOCKED_EXT = /\.(html?|xhtml|js|mjs|cjs|jsx|ts|php[0-9]?|phtml|asp|aspx|jsp|cgi|pl|py|rb|sh|bash|bat|cmd|com|exe|msi|dll|scr|vbs|vbe|wsf|ps1|jar|apk|dmg|svgz)$/i;
const BLOCKED_MIME = /^(text\/html|application\/(x-httpd-php|javascript|x-javascript|x-msdownload|x-sh|x-msdos-program|java-archive|vnd\.microsoft\.portable-executable))/i;

export function blockedFileReason(name: string, mime: string): string | null {
  if (BLOCKED_EXT.test(name) || BLOCKED_MIME.test(mime || "")) return "Executable and web-page files (.exe, .js, .html …) can't be uploaded.";
  return null;
}

/** Client + server validation for one file; null when it is fine. */
export function validateMediaFile(file: { name: string; size: number; type: string }): string | null {
  if (!file.name.trim()) return "The file has no name.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_MEDIA_BYTES) return `${file.name} is ${formatBytes(file.size)} – the limit is ${MAX_MEDIA_BYTES_LABEL}.`;
  return blockedFileReason(file.name, file.type);
}

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** "My Photo (1).PNG" → "my-photo-1.png" (keeps the extension, ASCII only). */
export function sanitizeFilename(name: string): string {
  const ext = extensionOf(name);
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "file"}${ext ? `.${ext}` : ""}`;
}

/** Display name with a new extension (used when converting formats). */
export function withExtension(name: string, ext: string): string {
  const current = extensionOf(name);
  return current ? `${name.slice(0, -(current.length + 1))}.${ext}` : `${name}.${ext}`;
}

export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/* ─── branding files (Settings → favicon / social share image) ───────────── */

/** Everything browsers accept for <link rel="icon">. */
export const FAVICON_MIME_TYPES = ["image/x-icon", "image/vnd.microsoft.icon", "image/png", "image/svg+xml", "image/webp", "image/jpeg", "image/gif", "image/avif"];
/** Open Graph images: raster only, no SVG / ICO. */
export const SHARE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const BRANDING_FOLDER = "Branding";

export type BrandingRole = "favicon" | "share_image";

/** Mime check shared by the picker (before upload) and the settings actions (on save). */
export function brandingFileProblem(file: { name: string; type: string }, role: BrandingRole): string | null {
  // browsers report .ico inconsistently (image/x-icon, image/vnd.microsoft.icon or nothing at all)
  const mime = (file.type || "").toLowerCase() || (/\.ico$/i.test(file.name) ? "image/x-icon" : "");
  if (role === "favicon") return FAVICON_MIME_TYPES.includes(mime) ? null : "Favicons must be an ICO, PNG, SVG, WebP, JPEG or GIF file.";
  return SHARE_IMAGE_MIME_TYPES.includes(mime) ? null : "Use a JPEG, PNG, WebP or GIF image for the share image.";
}

/** Raster formats sharp can read *and* write – the only ones optimise / convert / edit accept. */
export function isEditableImage(mime: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(mime);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "image/jpeg" → "JPEG", "application/pdf" → "PDF", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" → "DOCX". */
export function formatLabel(mime: string, name: string): string {
  const ext = extensionOf(name);
  if (ext) return ext.toUpperCase();
  const sub = (mime.split("/")[1] ?? "").split("+")[0];
  return (sub || "FILE").toUpperCase().slice(0, 8);
}

/* ─── image operations (shared between the UI and the server) ─────────────── */

export type OptimizeOptions = { format: "keep" | "webp" | "avif"; quality: number };

export type EditOps = {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Crop in percent of the *transformed* image (after rotate / flip); omitted = no crop. */
  crop?: { x: number; y: number; width: number; height: number } | null;
};

export type MediaPage = { items: MediaItem[]; total: number; page: number; perPage: number };
export type MediaTotals = { library_count: number; library_bytes: number; trash_count: number; trash_bytes: number };

/* ─── products ↔ media ─────────────────────────────────────────────────────── */

/** Columns of `media` that products embed (see `MediaRef`). */
export const MEDIA_REF_COLUMNS = "id, name, path, alt, width, height, variants, mime_type, kind, size, updated_at, deleted_at";

/** PostgREST error for a database that hasn't run the media migration yet. */
export function isMissingMediaSchema(message: string | undefined): boolean {
  return /image_media_id|product_media|relation "?(public\.)?media"?|media.*schema cache|Could not find a relationship/i.test(message ?? "");
}

/** Gallery rows come back unordered from the embed – sort by position and drop dangling refs. */
export function withSortedGallery<T extends Pick<Product, "gallery">>(product: T): T {
  if (!Array.isArray(product.gallery)) return product;
  const gallery = product.gallery.filter((g) => g.media && g.media.kind === "image" && !g.media.deleted_at).sort((a, b) => a.position - b.position);
  return { ...product, gallery };
}

export type GallerySlide = { src: string; thumb: string; alt: string };

/** Storefront slides: main image first, then the media-library gallery in admin order. */
export function slidesFor(product: { name: string; image_url: string | null; image_media?: MediaRef | null; gallery?: { media: MediaRef | null }[] }): GallerySlide[] {
  const slides: GallerySlide[] = [];
  if (product.image_url) {
    const m = product.image_media;
    slides.push({
      src: m ? (mediaPreviewUrl(m, "large") ?? product.image_url) : product.image_url,
      thumb: m ? (mediaPreviewUrl(m, "thumbnail") ?? product.image_url) : product.image_url,
      alt: m?.alt || product.name,
    });
  }
  for (const g of product.gallery ?? []) {
    if (!g.media) continue;
    slides.push({
      src: mediaPreviewUrl(g.media, "large") ?? mediaUrl(g.media.path),
      thumb: mediaPreviewUrl(g.media, "thumbnail") ?? mediaUrl(g.media.path),
      alt: g.media.alt || product.name,
    });
  }
  return slides;
}
