import type { MediaRef, Page, PageStatus, SiteSettings } from "@/lib/types";
import { mediaUrl } from "@/lib/media/shared";

/*
 * Pages (CMS) – constants, validation rules and SEO defaults shared by the
 * admin form (client), the Server Actions and the storefront template.
 * No `server-only` import on purpose.
 */

export const PAGE_STATUSES: { id: PageStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
];

export const PAGE_TITLE_MAX = 200;
export const PAGE_SLUG_MAX = 120;
/** Hard limits (database) – the counters in the form show the recommended length. */
export const SEO_TITLE_MAX = 120;
export const SEO_TITLE_RECOMMENDED = 60;
export const SEO_DESCRIPTION_MAX = 320;
export const SEO_DESCRIPTION_RECOMMENDED = 160;
export const CANONICAL_URL_MAX = 500;
/** Sanitised HTML stored per page. */
export const PAGE_CONTENT_MAX = 200_000;
export const MAX_PAGE_TAGS = 20;
export const TAG_NAME_MAX = 50;

export const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Top-level paths that belong to the app itself. A page can never take one of
 * these slugs – Next.js would route to the static page anyway, so the admin
 * gets a clear error instead of a page that can't be reached.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "cart",
  "checkout",
  "login",
  "signup",
  "orders",
  "shop",
  "products",
  "categories",
  "nemesis",
  "admin",
  "preview",
  "media",
  "static",
  "assets",
  "images",
  "public",
  "sitemap",
  "sitemap.xml",
  "robots.txt",
  "favicon.ico",
  "manifest.json",
  "index",
  "home",
  "404",
  "500",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug) || slug.startsWith("_") || slug.startsWith(".");
}

/** Same rules as products / categories: lowercase, ASCII letters + digits, single dashes. */
export function slugifyPage(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PAGE_SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Public path of a page. */
export const pageHref = (slug: string) => `/${slug}`;

/** Admin-only preview (renders drafts in the storefront layout). */
export const pagePreviewHref = (id: string) => `/preview/pages/${id}`;

export type PageSort = "updated_desc" | "created_desc" | "published_desc" | "title_asc" | "title_desc";

export const PAGE_SORTS: { id: PageSort; label: string }[] = [
  { id: "updated_desc", label: "Last updated" },
  { id: "created_desc", label: "Newest first" },
  { id: "published_desc", label: "Recently published" },
  { id: "title_asc", label: "Title A → Z" },
  { id: "title_desc", label: "Title Z → A" },
];

export function parsePageSort(value: unknown): PageSort {
  return PAGE_SORTS.some((s) => s.id === value) ? (value as PageSort) : "updated_desc";
}

export function parsePageStatus(value: unknown): PageStatus | "" {
  return value === "draft" || value === "published" ? value : "";
}

/* ─── Tags ────────────────────────────────────────────────────────────────── */

/** Trim, collapse whitespace, cap the length – "  Shipping   Info " → "Shipping Info". */
export function normaliseTagName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, TAG_NAME_MAX).trim();
}

export const tagSlug = (name: string) => slugifyPage(name).slice(0, TAG_NAME_MAX) || "tag";

/** Tag names are compared case-insensitively ("FAQ" and "faq" are the same tag). */
export const tagKey = (name: string) => normaliseTagName(name).toLowerCase();

/** Splits the submitted `tags` field (one name per line or comma) into unique, normalised names. */
export function parseTagNames(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const name = normaliseTagName(part);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_PAGE_TAGS) break;
  }
  return out;
}

/* ─── Text helpers (excerpt, SEO defaults) ────────────────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Plain text of an HTML fragment – good enough for excerpts and snippet previews. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|td|th|pre|figcaption)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      const key = code.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** First `max` characters of `text`, cut at a word boundary with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

export const excerptFromHtml = (html: string, max = SEO_DESCRIPTION_RECOMMENDED) => truncate(htmlToText(html), max);

/** Absolute http(s) URL without whitespace or credentials. */
export function isValidCanonical(url: string): boolean {
  if (!url || url.length > CANONICAL_URL_MAX || /\s/.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/* ─── SEO defaults ────────────────────────────────────────────────────────── */

export type PageSeo = {
  title: string;
  description: string | null;
  canonical: string | null;
  robots: { index: boolean; follow: boolean };
  ogTitle: string;
  ogDescription: string | null;
  ogImage: string | null;
};

const pick = (...values: (string | null | undefined)[]) => values.find((v) => typeof v === "string" && v.trim())?.trim() ?? null;

/**
 * What ends up in <head>: explicit SEO fields first, then sensible defaults
 * from the title / content / featured image. `siteUrl` = Settings → SEO → site
 * URL (null while unknown → no canonical). Search engines treat these as hints.
 */
export function pageSeo(
  page: Pick<Page, "title" | "slug" | "content" | "excerpt" | "seo_title" | "seo_description" | "canonical_url" | "robots_index" | "robots_follow" | "og_title" | "og_description"> & {
    featured_image?: MediaRef | null;
    og_image?: MediaRef | null;
  },
  siteUrl: string | null,
  indexingEnabled = true,
): PageSeo {
  const title = pick(page.seo_title, page.title) ?? page.title;
  const description = pick(page.seo_description, page.excerpt) ?? (page.content ? excerptFromHtml(page.content) || null : null);
  const image = page.og_image && !page.og_image.deleted_at ? page.og_image : page.featured_image && !page.featured_image.deleted_at ? page.featured_image : null;
  return {
    title,
    description,
    canonical: pick(page.canonical_url) ?? (siteUrl ? `${siteUrl}${pageHref(page.slug)}` : null),
    robots: { index: indexingEnabled && page.robots_index, follow: indexingEnabled && page.robots_follow },
    ogTitle: pick(page.og_title) ?? title,
    ogDescription: pick(page.og_description) ?? description,
    ogImage: image ? mediaUrl(image.path) : null,
  };
}

/** Site-settings slice the storefront template needs for a page's metadata. */
export type PageSeoContext = Pick<SiteSettings, "seo_indexing" | "store_name">;
