"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import { removeProductImageIfOwned, uploadProductImage, validateImageFile } from "@/lib/admin/storage";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import { MENU_TAG } from "@/lib/menu";
import { safeListReturn } from "@/lib/admin/pagination";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

/* ──────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ────────────────────────────────────────────────────────────────────────── */

export type AdminFormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of the submitted values so the form keeps them after a failed submit. */
  values?: Record<string, string>;
} | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const str = (fd: FormData, key: string, max = 500) =>
  (typeof fd.get(key) === "string" ? (fd.get(key) as string) : "").trim().slice(0, max);
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "19.99" → 1999 cents; returns null when empty, NaN when invalid. */
function parseMoney(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

function echo(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

/** Turns thrown Errors *and* plain Supabase/PostgREST error objects into a readable sentence. */
function friendlyError(e: unknown): string {
  if (e instanceof AdminAuthError) return e.message;
  const record = typeof e === "object" && e !== null ? (e as { message?: unknown; code?: unknown; details?: unknown }) : null;
  const message = e instanceof Error ? e.message : typeof record?.message === "string" ? record.message : typeof e === "string" ? e : "";
  const code = typeof record?.code === "string" ? record.code : "";
  if (code === "23505" || /duplicate key/.test(message)) return "That slug is already in use. Please pick another one.";
  if (code === "23514" || /stock_check|violates check constraint/.test(message)) return "Not enough stock to re-open this order.";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "You are not allowed to do that.";
  return message || "Something went wrong. Please try again.";
}

async function adminClient() {
  const user = await assertAdmin();
  const supabase = await createClient();
  return { user, supabase };
}

/** Admin writes touch data that the storefront renders dynamically – purge the router cache for everything. */
function revalidateStore() {
  revalidatePath("/", "layout");
}

const withFlash = (path: string, key: "notice" | "error", message: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const notice = (path: string, message: string) => withFlash(path, "notice", message);
const failure = (path: string, message: string) => withFlash(path, "error", message);

/** Where a list action sends the admin afterwards: the exact list page (page / size / filter) they came from. */
const returnTo = (fd: FormData, listPath: string) => safeListReturn(str(fd, "return_to", 600), listPath) ?? listPath;
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
  const imageFile = formData.get("image_file");

  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (priceCents === null || Number.isNaN(priceCents)) fieldErrors.price = "Enter a valid price, e.g. 19.99.";
  if (Number.isNaN(compareAtCents)) fieldErrors.compare_at_price = "Enter a valid price or leave empty.";
  if (!Number.isInteger(stock) || stock < 0) fieldErrors.stock = "Stock must be a whole number ≥ 0.";
  if (categoryId && !UUID_RE.test(categoryId)) fieldErrors.category_id = "Invalid category.";
  if (imageMode === "url") {
    if (!/^https?:\/\/\S+$/i.test(imageUrlInput)) fieldErrors.image_url = "Enter a full image URL starting with http:// or https://.";
  }
  if (imageMode === "upload") {
    if (!(imageFile instanceof File) || imageFile.size === 0) fieldErrors.image_file = "Choose an image to upload.";
    else {
      const problem = validateImageFile(imageFile);
      if (problem) fieldErrors.image_file = problem;
    }
  }
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();

    // ── current state (for image clean-up) ─────────────────────────────────
    let previousImageUrl: string | null = null;
    if (isEdit) {
      const { data: current, error } = await supabase.from("products").select("image_url").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!current) return { error: "This product no longer exists.", values };
      previousImageUrl = current.image_url;
    }

    // ── figure out the new image ───────────────────────────────────────────
    let imageUrl: string | null = previousImageUrl;
    let uploadedPath: string | null = null;
    if (imageMode === "upload" && imageFile instanceof File) {
      const uploaded = await uploadProductImage(supabase, imageFile, slug);
      imageUrl = uploaded.url;
      uploadedPath = uploaded.path;
    } else if (imageMode === "url") {
      imageUrl = imageUrlInput;
    } else if (imageMode === "remove") {
      imageUrl = null;
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
      image_url: imageUrl,
    };

    const result = isEdit
      ? await supabase.from("products").update(row).eq("id", id).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();

    if (result.error) {
      // don't leave an orphaned upload behind
      if (uploadedPath) await supabase.storage.from("product-images").remove([uploadedPath]);
      throw result.error;
    }

    // The old file is only removed once the row points at the new image.
    if (previousImageUrl && previousImageUrl !== imageUrl) {
      await removeProductImageIfOwned(supabase, previousImageUrl);
    }

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
    const { data: product, error } = await supabase.from("products").select("name, image_url").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!product) redirect(failure(back, "Product not found."));

    const { error: delError } = await supabase.from("products").delete().eq("id", id);
    if (delError) throw delError;
    await removeProductImageIfOwned(supabase, product.image_url);

    revalidateStore();
    redirect(notice(back, `"${product.name}" deleted.`));
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
  const sortOrder = Number(str(formData, "sort_order", 10) || "0");
  const showInMenu = bool(formData, "show_in_menu");

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (!Number.isInteger(sortOrder)) fieldErrors.sort_order = "Sort order must be a whole number.";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();
    const row = { name, slug, sort_order: sortOrder, show_in_menu: showInMenu };
    const result = isEdit
      ? await supabase.from("categories").update(row).eq("id", id).select("id").single()
      : await supabase.from("categories").insert(row).select("id").single();
    if (result.error) throw result.error;

    updateTag(MENU_TAG); // header navigation
    revalidateStore();
    redirect(notice("/nemesis/categories", isEdit ? `"${name}" updated.` : `"${name}" created.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: friendlyError(e), values };
  }
}

/** Show / hide a category in the storefront header menu (one click from the list). */
export async function toggleCategoryMenu(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) redirect(failure("/nemesis/categories", "Invalid category id."));
  try {
    const { supabase } = await adminClient();
    const { data: category, error } = await supabase.from("categories").select("name, show_in_menu").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!category) redirect(failure("/nemesis/categories", "Category not found."));

    const show = !category.show_in_menu;
    const { error: updError } = await supabase.from("categories").update({ show_in_menu: show }).eq("id", id);
    if (updError) throw updError;

    updateTag(MENU_TAG);
    revalidateStore();
    redirect(notice("/nemesis/categories", show ? `"${category.name}" is now shown in the header menu.` : `"${category.name}" is hidden from the header menu.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure("/nemesis/categories", friendlyError(e)));
  }
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) redirect(failure("/nemesis/categories", "Invalid category id."));
  try {
    const { supabase } = await adminClient();
    const { data: category, error } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!category) redirect(failure("/nemesis/categories", "Category not found."));

    // products.category_id is `on delete set null` → products survive, uncategorised
    const { error: delError } = await supabase.from("categories").delete().eq("id", id);
    if (delError) throw delError;

    updateTag(MENU_TAG);
    revalidateStore();
    redirect(notice("/nemesis/categories", `"${category.name}" deleted. Its products are now uncategorised.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure("/nemesis/categories", friendlyError(e)));
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

/* ──────────────────────────────────────────────────────────────────────────
 * Site settings
 * ────────────────────────────────────────────────────────────────────────── */

export async function updateSiteSettings(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const storeName = str(formData, "store_name", 60);
  const tagline = str(formData, "tagline", 160);
  const supportEmail = str(formData, "support_email", 120);

  const fieldErrors: Record<string, string> = {};
  if (!storeName) fieldErrors.store_name = "The store name can't be empty.";
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) fieldErrors.support_email = "Enter a valid e-mail address.";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase
      .from("site_settings")
      .update({ store_name: storeName, tagline: tagline || null, support_email: supportEmail || null })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: "Settings row is missing – run the admin migration (20261016000000_admin.sql).", values };

    updateTag(SITE_SETTINGS_TAG); // header, footer & <title> pick up the new name immediately
    revalidateStore();
    return { success: "Settings saved.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/* `redirect()` works by throwing – make sure our catch blocks let it through. */
function isRedirectError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
