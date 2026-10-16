import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { safeListReturn } from "@/lib/admin/pagination";
import { SITEMAP_TAG } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

/*
 * Helpers shared by every admin Server Action (products, categories, orders,
 * users, settings, pages …): FormData parsing, the form-state contract of
 * `useActionState` forms, flash redirects and error translation.
 */

export type AdminFormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of the submitted values so the form keeps them after a failed submit. */
  values?: Record<string, string>;
} | null;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Trimmed string field, capped at `max` characters (anything else → ""). */
export const str = (fd: FormData, key: string, max = 500) =>
  (typeof fd.get(key) === "string" ? (fd.get(key) as string) : "").trim().slice(0, max);

/** Checkbox / switch field: "on" or "true" → true. */
export const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

export function slugify(input: string, max = 80): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Every string field of the submission, so a failed form can re-render what was typed. */
export function echo(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

/** Turns thrown Errors *and* plain Supabase/PostgREST error objects into a readable sentence. */
export function friendlyError(e: unknown): string {
  if (e instanceof AdminAuthError) return e.message;
  const record = typeof e === "object" && e !== null ? (e as { message?: unknown; code?: unknown; details?: unknown }) : null;
  const message = e instanceof Error ? e.message : typeof record?.message === "string" ? record.message : typeof e === "string" ? e : "";
  const code = typeof record?.code === "string" ? record.code : "";
  if (code === "23505" || /duplicate key/.test(message)) return "That slug is already in use. Please pick another one.";
  if (code === "23514" || /stock_check|violates check constraint/.test(message)) return "Not enough stock to re-open this order.";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "You are not allowed to do that.";
  if (/product_variations|product_attributes|variation_id|variation_label|"type"|column products\.type/i.test(message))
    return "The variable-product tables are missing – run supabase/migrations/20261027000000_variations.sql in the Supabase SQL Editor, then try again.";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST204" || /relation "?(public\.)?(media|product_media)"? does not exist|image_media_id|product_media.*schema cache|media.*schema cache/i.test(message))
    return "The Media Library tables are missing – run supabase/migrations/20261019000000_media_library.sql in the Supabase SQL Editor, then try again.";
  if (/relation "?(public\.)?(pages|tags|page_tags|page_media)"? does not exist|(pages|page_tags|page_media|tags).*schema cache/i.test(message))
    return "The Pages tables are missing – run supabase/migrations/20261021000000_pages.sql in the Supabase SQL Editor, then try again.";
  if (/menu_items/i.test(message) && /does not exist|schema cache|Could not find/i.test(message))
    return "The menu table is missing – run supabase/migrations/20261023000000_menus.sql in the Supabase SQL Editor, then try again.";
  return message || "Something went wrong. Please try again.";
}

/** Admin guard + Supabase client for a Server Action. */
export async function adminClient() {
  const user = await assertAdmin();
  const supabase = await createClient();
  return { user, supabase };
}

/** Admin writes touch data that the storefront renders dynamically – purge the router cache for everything. */
export function revalidateStore() {
  revalidatePath("/", "layout");
  updateTag(SITEMAP_TAG); // product / category / settings / page changes all show up in sitemap.xml
}

const withFlash = (path: string, key: "notice" | "error", message: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
/** `path?notice=…` – shown as a success toast by <FlashToast>. */
export const notice = (path: string, message: string) => withFlash(path, "notice", message);
/** `path?error=…` – shown as an error toast by <FlashToast>. */
export const failure = (path: string, message: string) => withFlash(path, "error", message);

/** Where a list action sends the admin afterwards: the exact list page (page / size / filter) they came from. */
export const returnTo = (fd: FormData, listPath: string) => safeListReturn(str(fd, "return_to", 600), listPath) ?? listPath;

/** Bulk actions post one `ids` field per selected row; a page never holds more than 100. */
export const MAX_BULK_IDS = 200;
export function idsFrom(fd: FormData): string[] {
  const ids = fd
    .getAll("ids")
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => UUID_RE.test(v));
  return [...new Set(ids)].slice(0, MAX_BULK_IDS);
}

export const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/** `redirect()` works by throwing – let it through every catch block. */
export function isRedirectError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
