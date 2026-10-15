"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import { MAX_PRODUCT_GALLERY, brandingFileProblem, mediaUrl, type BrandingRole } from "@/lib/media/shared";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import { MENU_TAG } from "@/lib/menu";
import type { OrderStatus, PaymentStatus } from "@/lib/types";
import {
  UUID_RE,
  SLUG_RE,
  adminClient,
  bool,
  count,
  echo,
  failure,
  friendlyError,
  idsFrom,
  isRedirectError,
  notice,
  returnTo,
  revalidateStore,
  slugify,
  str,
  type AdminFormState,
} from "@/lib/admin/form";

/* ──────────────────────────────────────────────────────────────────────────
 * Shared helpers live in src/lib/admin/form.ts (also used by the pages / media actions)
 * ────────────────────────────────────────────────────────────────────────── */

export type { AdminFormState } from "@/lib/admin/form";

/** "19.99" → 1999 cents; returns null when empty, NaN when invalid. */
function parseMoney(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

const productsReturn = (fd: FormData) => returnTo(fd, "/nemesis/products");

/* ──────────────────────────────────────────────────────────────────────────
 * Products
 * ────────────────────────────────────────────────────────────────────────── */

export async function saveProduct(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid product id.", values };

  // ── validate ──────────────────────────────────────────────────────────────
  const fieldErrors: Record<string, string> = {};
  const name = str(formData, "name", 200);
  const slug = slugify(str(formData, "slug", 100) || name);
  const description = str(formData, "description", 5000);
  const categoryId = str(formData, "category_id", 40);
  const priceCents = parseMoney(str(formData, "price", 20));
  const compareAtCents = parseMoney(str(formData, "compare_at_price", 20));
  const stock = Number(str(formData, "stock", 10) || "0");
  const isActive = bool(formData, "is_active");
  const isFeatured = bool(formData, "is_featured");
  const imageMode = str(formData, "image_mode", 10) || "keep";
  const imageUrlInput = str(formData, "image_url", 2000);
  const imageMediaId = str(formData, "image_media_id", 40);
  const galleryIds = [...new Set(str(formData, "gallery_ids", 2000).split(",").map((v) => v.trim()).filter(Boolean))];

  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (priceCents === null || Number.isNaN(priceCents)) fieldErrors.price = "Enter a valid price, e.g. 19.99.";
  if (Number.isNaN(compareAtCents)) fieldErrors.compare_at_price = "Enter a valid price or leave empty.";
  if (!Number.isInteger(stock) || stock < 0) fieldErrors.stock = "Stock must be a whole number ≥ 0.";
  if (categoryId && !UUID_RE.test(categoryId)) fieldErrors.category_id = "Invalid category.";
  if (!["keep", "media", "url", "remove"].includes(imageMode)) fieldErrors.image_media_id = "Invalid image selection.";
  if (imageMode === "url" && !/^https?:\/\/\S+$/i.test(imageUrlInput)) fieldErrors.image_url = "Enter a full image URL starting with http:// or https://.";
  if (imageMode === "media" && !UUID_RE.test(imageMediaId)) fieldErrors.image_media_id = "Pick an image from the Media Library.";
  if (galleryIds.some((g) => !UUID_RE.test(g))) fieldErrors.gallery_ids = "Invalid gallery selection.";
  if (galleryIds.length > MAX_PRODUCT_GALLERY) fieldErrors.gallery_ids = `A gallery can hold at most ${MAX_PRODUCT_GALLERY} images.`;
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();

    if (isEdit) {
      const { data: current, error } = await supabase.from("products").select("id").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!current) return { error: "This product no longer exists.", values };
    }

    // ── resolve media-library references (must exist, be images, not trashed) ──
    const wanted = [...new Set([...(imageMode === "media" ? [imageMediaId] : []), ...galleryIds])];
    const found = new Map<string, { id: string; path: string }>();
    if (wanted.length) {
      const { data, error } = await supabase.from("media").select("id, path, kind, deleted_at").in("id", wanted);
      if (error) throw error;
      for (const m of (data ?? []) as { id: string; path: string; kind: string; deleted_at: string | null }[]) {
        if (m.kind === "image" && !m.deleted_at) found.set(m.id, m);
      }
      if (imageMode === "media" && !found.has(imageMediaId)) {
        return { error: "Please fix the highlighted fields.", fieldErrors: { image_media_id: "That image is no longer in the Media Library – pick another one." }, values };
      }
      const missing = galleryIds.filter((g) => !found.has(g));
      if (missing.length) {
        return { error: "Please fix the highlighted fields.", fieldErrors: { gallery_ids: `${missing.length} gallery ${missing.length === 1 ? "image is" : "images are"} no longer in the Media Library – remove ${missing.length === 1 ? "it" : "them"} and try again.` }, values };
      }
    }

    // ── figure out the new main image ("keep" leaves both columns alone) ────
    const image: { image_url?: string | null; image_media_id?: string | null } = {};
    if (imageMode === "media") {
      image.image_url = mediaUrl(found.get(imageMediaId)!.path);
      image.image_media_id = imageMediaId;
    } else if (imageMode === "url") {
      image.image_url = imageUrlInput;
      image.image_media_id = null;
    } else if (imageMode === "remove") {
      image.image_url = null;
      image.image_media_id = null;
    }

    const row = {
      name,
      slug,
      description: description || null,
      category_id: categoryId || null,
      price_cents: priceCents as number,
      compare_at_price_cents: compareAtCents,
      stock,
      is_active: isActive,
      is_featured: isFeatured,
      ...image,
    };

    const result = isEdit
      ? await supabase.from("products").update(row).eq("id", id).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();
    if (result.error) throw result.error;
    const productId = result.data.id as string;

    // ── gallery: replace the ordered set in one go ──────────────────────────
    const { error: clearError } = await supabase.from("product_media").delete().eq("product_id", productId);
    if (clearError) throw clearError;
    if (galleryIds.length) {
      const { error: insertError } = await supabase.from("product_media").insert(galleryIds.map((media_id, position) => ({ product_id: productId, media_id, position })));
      if (insertError) throw insertError;
    }

    // Media Library files are never deleted from here – they stay reusable.
    revalidateStore();
    redirect(notice(isEdit ? productsReturn(formData) : "/nemesis/products", isEdit ? `"${name}" updated.` : `"${name}" created.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const back = productsReturn(formData);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid product id."));
  try {
    const { supabase } = await adminClient();
    const { data: product, error } = await supabase.from("products").select("name").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!product) redirect(failure(back, "Product not found."));

    const { error: delError } = await supabase.from("products").delete().eq("id", id);
    if (delError) throw delError;

    revalidateStore();
    redirect(notice(back, `"${product.name}" deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/** Deletes every selected product in one statement (their Media Library files stay in the library). */
export async function deleteProducts(formData: FormData): Promise<void> {
  const back = productsReturn(formData);
  const ids = idsFrom(formData);
  if (ids.length === 0) redirect(failure(back, "Select at least one product first."));
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("products").delete().in("id", ids).select("id");
    if (error) throw error;
    const deleted = data ?? [];
    if (deleted.length === 0) redirect(failure(back, "Those products no longer exist."));

    revalidateStore();
    redirect(notice(back, `${count(deleted.length, "product", "products")} deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Categories
 * ────────────────────────────────────────────────────────────────────────── */

export async function saveCategory(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid category id.", values };

  const name = str(formData, "name", 100);
  const slug = slugify(str(formData, "slug", 100) || name);

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();
    const row = { name, slug };
    let result;
    if (isEdit) {
      result = await supabase.from("categories").update(row).eq("id", id).select("id").single();
    } else {
      // New categories join the end of the list; the position is changed by dragging rows in the list.
      const { data: last, error: lastError } = await supabase.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
      if (lastError) throw lastError;
      result = await supabase.from("categories").insert({ ...row, sort_order: (last?.sort_order ?? -1) + 1 }).select("id").single();
    }
    if (result.error) throw result.error;

    updateTag(MENU_TAG); // menu items that link to this category follow its slug
    revalidateStore();
    // The quick-add form on the list page stays where it is (the list refreshes in place);
    // the edit page goes back to the list.
    if (!isEdit && bool(formData, "stay")) return { success: `"${name}" created.` };
    redirect(notice("/nemesis/categories", isEdit ? `"${name}" updated.` : `"${name}" created.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

/**
 * Store the order the admin dragged the categories into: `sort_order` becomes the row's
 * position in `ids`. Everything that lists categories (header menu, filters, sitemap)
 * orders by that column, so the storefront follows immediately.
 */
export async function reorderCategories(ids: string[]): Promise<{ error?: string }> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { error: "Invalid category order." };
  }
  if (new Set(ids).size !== ids.length) return { error: "Invalid category order." };
  try {
    const { supabase } = await adminClient();
    const { data: existing, error: loadError } = await supabase.from("categories").select("id").in("id", ids);
    if (loadError) throw loadError;
    if ((existing ?? []).length !== ids.length) return { error: "A category was removed in the meantime – the list has been refreshed." };

    const results = await Promise.all(ids.map((id, index) => supabase.from("categories").update({ sort_order: index }).eq("id", id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    revalidateStore(); // shop filter + sitemap; also refreshes /nemesis/categories (revalidatePath("/", "layout"))
    return {};
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Show / hide a category in the storefront header menu (one click from the list). */
/**
 * From the list (no `return_to`) the row disappears in place and the message is a toast;
 * from the detail page (`return_to`) it redirects back to the list.
 */
export async function deleteCategory(formData: FormData): Promise<AdminFormState> {
  const back = str(formData, "return_to", 600) ? returnTo(formData, "/nemesis/categories") : null;
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) {
    if (back) redirect(failure(back, "Invalid category id."));
    return { error: "Invalid category id." };
  }
  try {
    const { supabase } = await adminClient();
    const { data: category, error } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!category) {
      if (back) redirect(failure(back, "Category not found."));
      revalidateStore();
      return { error: "That category no longer exists – the list has been refreshed." };
    }

    // products.category_id is `on delete set null` → products survive, uncategorised
    const { error: delError } = await supabase.from("categories").delete().eq("id", id);
    if (delError) throw delError;

    updateTag(MENU_TAG);
    revalidateStore();
    const message = `"${category.name}" deleted. Its products are now uncategorised.`;
    if (back) redirect(notice(back, message));
    return { success: message };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (back) redirect(failure(back, friendlyError(e)));
    return { error: friendlyError(e) };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Orders
 * ────────────────────────────────────────────────────────────────────────── */

export async function updateOrder(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) return { error: "Invalid order id." };

  const status = str(formData, "status", 20) as OrderStatus;
  const paymentStatus = str(formData, "payment_status", 20) as PaymentStatus;
  if (!ORDER_STATUSES.includes(status)) return { error: "Invalid order status." };
  if (!PAYMENT_STATUSES.includes(paymentStatus)) return { error: "Invalid payment status." };

  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase
      .from("orders")
      .update({ status, payment_status: paymentStatus })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: "Order not found." };

    revalidateStore();
    return { success: "Order updated." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function deleteOrder(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const back = returnTo(formData, "/nemesis/orders");
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid order id."));
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("orders").delete().eq("id", id).select("order_number").maybeSingle();
    if (error) throw error;
    if (!data) redirect(failure(back, "Order not found."));

    revalidateStore();
    redirect(notice(back, `Order #${String(data.order_number).padStart(4, "0")} deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/** Deletes every selected order (line items cascade) in one statement. */
export async function deleteOrders(formData: FormData): Promise<void> {
  const back = returnTo(formData, "/nemesis/orders");
  const ids = idsFrom(formData);
  if (ids.length === 0) redirect(failure(back, "Select at least one order first."));
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("orders").delete().in("id", ids).select("id");
    if (error) throw error;
    const n = data?.length ?? 0;
    if (n === 0) redirect(failure(back, "Those orders no longer exist."));

    revalidateStore();
    redirect(notice(back, `${count(n, "order", "orders")} deleted.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Users
 * ────────────────────────────────────────────────────────────────────────── */

export async function updateUser(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) return { error: "Invalid user id.", values };

  const fullName = str(formData, "full_name", 120);
  const phone = str(formData, "phone", 40);
  const isAdmin = bool(formData, "is_admin");

  try {
    const { user, supabase } = await adminClient();
    if (user.id === id && !isAdmin) {
      return { error: "You can't remove your own admin access. Ask another admin to do it.", values };
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ full_name: fullName || null, phone: phone || null, is_admin: isAdmin })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: "User not found.", values };

    revalidateStore();
    return { success: "User updated." };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

export async function deleteUser(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  const back = returnTo(formData, "/nemesis/users");
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid user id."));
  try {
    const { user, supabase } = await adminClient();
    if (user.id === id) redirect(failure(back, "You cannot delete your own account from the dashboard."));

    const { error } = await supabase.rpc("admin_delete_user", { p_user_id: id });
    if (error) throw error;

    revalidateStore();
    redirect(notice(back, "User deleted. Their orders were kept for your records."));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/**
 * Deletes every selected account through `admin_delete_user` (one call each – the function
 * re-checks the admin role and refuses the caller's own id). Partial failures are reported,
 * not hidden: the ones that worked stay deleted.
 */
export async function deleteUsers(formData: FormData): Promise<void> {
  const back = returnTo(formData, "/nemesis/users");
  const requested = idsFrom(formData);
  if (requested.length === 0) redirect(failure(back, "Select at least one user first."));
  try {
    const { user, supabase } = await adminClient();
    const ids = requested.filter((id) => id !== user.id);
    if (ids.length === 0) redirect(failure(back, "You cannot delete your own account from the dashboard."));

    const results = await Promise.all(ids.map((id) => supabase.rpc("admin_delete_user", { p_user_id: id })));
    const failed = results.filter((r) => r.error);
    const deleted = ids.length - failed.length;

    if (deleted > 0) revalidateStore();
    const skippedSelf = ids.length < requested.length ? " Your own account was skipped." : "";
    if (failed.length === 0) redirect(notice(back, `${count(deleted, "user", "users")} deleted. Their orders were kept for your records.${skippedSelf}`));
    const reason = friendlyError(failed[0].error);
    if (deleted === 0) redirect(failure(back, `Could not delete the selected ${ids.length === 1 ? "user" : "users"}: ${reason}`));
    redirect(failure(back, `${count(deleted, "user", "users")} deleted, ${failed.length} could not be deleted: ${reason}${skippedSelf}`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Site settings
 * ────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
 * Site settings – one Server Action per tab (General · SEO · WooCommerce)
 * ────────────────────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[A-Za-z0-9_]+$/;

/** "@shop", "t.me/shop", "https://telegram.me/shop" → "shop" */
function normaliseTelegram(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:t|telegram)\.me\//i, "")
    .replace(/^(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

/** "@shop", "x.com/shop", "https://twitter.com/shop" → "shop" */
function normaliseTwitter(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

/** Accepts the bare token *or* the full <meta … content="…"> tag the search consoles hand out. */
function normaliseVerificationToken(input: string): string {
  const fromMeta = /content=["']([^"']+)["']/i.exec(input);
  return (fromMeta ? fromMeta[1] : input).trim();
}

/** Writes `patch` onto the single settings row and refreshes everything that renders it. */
async function saveSiteSettings(patch: Record<string, unknown>): Promise<string | null> {
  const { supabase } = await adminClient();
  const { data, error } = await supabase.from("site_settings").update(patch).eq("id", 1).select("id").maybeSingle();
  if (error) {
    if (error.code === "42703" || /column .* does not exist|schema cache/i.test(error.message ?? "")) {
      const media = /media_id/i.test(error.message ?? "");
      return `The database is missing the new settings columns – run supabase/migrations/${media ? "20261020000000_single_media_bucket.sql" : "20261018000000_settings_tabs.sql"} in the Supabase SQL Editor.`;
    }
    throw error;
  }
  if (!data) return "Settings row is missing – run the admin migration (20261016000000_admin.sql).";
  updateTag(SITE_SETTINGS_TAG); // header, footer, <title>, robots & sitemap pick the change up immediately
  revalidateStore();
  return null;
}

/**
 * Branding images come from the Media Library (`<field>_mode` = keep | media | remove,
 * `<field>_media_id`). Returns the columns to write, or nothing for "keep".
 */
async function resolveBrandingField(
  formData: FormData,
  field: BrandingRole,
  fieldErrors: Record<string, string>,
): Promise<Record<string, string | null>> {
  const mode = str(formData, `${field}_mode`, 10) || "keep";
  const mediaId = str(formData, `${field}_media_id`, 40);
  const urlColumn = field === "favicon" ? "favicon_url" : "seo_og_image_url";
  const idColumn = field === "favicon" ? "favicon_media_id" : "seo_og_image_media_id";
  if (mode === "remove") return { [urlColumn]: null, [idColumn]: null };
  if (mode !== "media") return {};
  if (!UUID_RE.test(mediaId)) {
    fieldErrors[`${field}_media_id`] = "Pick an image from the Media Library.";
    return {};
  }
  const { supabase } = await adminClient();
  const { data, error } = await supabase.from("media").select("id, name, path, mime_type, kind, deleted_at").eq("id", mediaId).maybeSingle();
  if (error) throw error;
  const item = data as { id: string; name: string; path: string; mime_type: string; kind: string; deleted_at: string | null } | null;
  const problem = !item || item.deleted_at || item.kind !== "image" ? "That image is no longer in the Media Library – pick another one." : brandingFileProblem({ name: item.name, type: item.mime_type }, field);
  if (problem) {
    fieldErrors[`${field}_media_id`] = problem;
    return {};
  }
  return { [urlColumn]: mediaUrl(item!.path), [idColumn]: item!.id };
}

export async function updateGeneralSettings(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const storeName = str(formData, "store_name", 60);
  const tagline = str(formData, "tagline", 160);
  const supportEmail = str(formData, "support_email", 120);
  const whatsappRaw = str(formData, "whatsapp", 40);
  const telegramRaw = str(formData, "telegram", 120);

  const fieldErrors: Record<string, string> = {};
  if (!storeName) fieldErrors.store_name = "The site title can't be empty.";
  if (supportEmail && !EMAIL_RE.test(supportEmail)) fieldErrors.support_email = "Enter a valid e-mail address.";

  const whatsapp = whatsappRaw.replace(/\D/g, "");
  if (whatsappRaw && (!/^[+\d][\d\s().-]*$/.test(whatsappRaw) || whatsapp.length < 7 || whatsapp.length > 15)) {
    fieldErrors.whatsapp = "Enter the number in international format, e.g. +880 1700 000000.";
  }

  const telegram = normaliseTelegram(telegramRaw);
  if (telegramRaw && (!HANDLE_RE.test(telegram) || telegram.length < 5 || telegram.length > 32)) {
    fieldErrors.telegram = "Enter a Telegram username (5–32 letters, digits or underscores).";
  }

  try {
    const favicon = await resolveBrandingField(formData, "favicon", fieldErrors);
    if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

    const problem = await saveSiteSettings({
      store_name: storeName,
      tagline: tagline || null,
      support_email: supportEmail || null,
      whatsapp: whatsapp || null,
      telegram: telegram || null,
      ...favicon,
    });
    if (problem) return { error: problem, values };
    return { success: "General settings saved.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

export async function updateSeoSettings(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const indexing = bool(formData, "seo_indexing");
  const siteUrlRaw = str(formData, "seo_site_url", 200);
  const title = str(formData, "seo_title", 100);
  const description = str(formData, "seo_description", 320);
  const twitterRaw = str(formData, "seo_twitter", 120);
  const google = normaliseVerificationToken(str(formData, "seo_google_verification", 300)).slice(0, 200);
  const bing = normaliseVerificationToken(str(formData, "seo_bing_verification", 300)).slice(0, 200);

  const fieldErrors: Record<string, string> = {};

  let siteUrl: string | null = null;
  if (siteUrlRaw) {
    try {
      const u = new URL(/^https?:\/\//i.test(siteUrlRaw) ? siteUrlRaw : `https://${siteUrlRaw}`);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") && u.hostname !== "localhost") throw new Error("bad");
      siteUrl = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      fieldErrors.seo_site_url = "Enter the full address of your store, e.g. https://www.example.com.";
    }
  }

  const twitter = normaliseTwitter(twitterRaw);
  if (twitterRaw && (!HANDLE_RE.test(twitter) || twitter.length > 15)) fieldErrors.seo_twitter = "Enter an X / Twitter handle, e.g. @yourstore.";
  if (google && !/^[A-Za-z0-9_\-=.:]+$/.test(google)) fieldErrors.seo_google_verification = "Paste only the code from the content=\"…\" attribute.";
  if (bing && !/^[A-Za-z0-9_\-=.:]+$/.test(bing)) fieldErrors.seo_bing_verification = "Paste only the code from the content=\"…\" attribute.";

  try {
    const shareImage = await resolveBrandingField(formData, "share_image", fieldErrors);
    if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

    const problem = await saveSiteSettings({
      seo_indexing: indexing,
      seo_site_url: siteUrl,
      seo_title: title || null,
      seo_description: description || null,
      seo_twitter: twitter || null,
      seo_google_verification: google || null,
      seo_bing_verification: bing || null,
      ...shareImage,
    });
    if (problem) return { error: problem, values };
    return { success: "SEO settings saved.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

export async function updateShopSettings(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const manageStock = bool(formData, "manage_stock");
  try {
    const problem = await saveSiteSettings({ manage_stock: manageStock });
    if (problem) return { error: problem, values };
    return { success: manageStock ? "Stock management enabled." : "Stock management disabled – every product is now unlimited.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/* `redirect()` works by throwing – make sure our catch blocks let it through. */
