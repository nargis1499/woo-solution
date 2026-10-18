"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/constants";
import { MAX_PRODUCT_GALLERY, brandingFileProblem, mediaUrl, type BrandingRole } from "@/lib/media/shared";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import {
  HOME_FILTER_TITLE_MAX,
  HOME_HERO_BADGE_MAX,
  HOME_HERO_CTA_HREF_MAX,
  HOME_HERO_CTA_TEXT_MAX,
  HOME_HERO_SUBTITLE_MAX,
  HOME_HERO_TITLE_MAX,
} from "@/lib/home-sections";
import { normaliseColors, normaliseGradients, type ThemeColors, type ThemeGradientSets } from "@/lib/theme";
import { DEFAULT_PRICE_MICROS, MAX_EXCHANGE_RATE, USD_MONEY, inputFromMicros, isCurrencyCode, parseExchangeRate, parseMoneyInput, toBaseMicros, type Money } from "@/lib/money";
import { isCategoryIconId } from "@/lib/category-icons";
import { MENU_TAG } from "@/lib/menu";
import { PRESENCE_VISIBILITIES, type PresenceVisibility } from "@/lib/presence";
import { passwordProblem } from "@/lib/password";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_OPTIONS,
  MAX_VARIATIONS,
  cleanOptions,
  combinationLabel,
  type SubmittedVariation,
} from "@/lib/variations";
import type { OrderStatus, PaymentStatus, ProductType } from "@/lib/types";
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

/**
 * The currency the product form displayed its prices in (hidden `money_*` fields). Prices
 * are stored in USD cents, so BDT input is divided by the rate the admin was looking at –
 * even if the setting changed in another tab meanwhile.
 */
function formMoney(formData: FormData): Money {
  const currency = str(formData, "money_currency", 10);
  const rate = Number(str(formData, "money_rate", 20));
  return isCurrencyCode(currency) && currency !== "USD" && Number.isFinite(rate) && rate > 0 ? { currency, rate } : USD_MONEY;
}

const productsReturn = (fd: FormData) => returnTo(fd, "/nemesis/products");

/* ──────────────────────────────────────────────────────────────────────────
 * Presence (Order inquiries) – the admin's own privacy switch, global + per customer
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The **global** fallback: what every customer sees who has no per-customer override
 * (see `store_presence_for()`). Only the row of the caller is touched, and only the
 * admin area can call it (`adminClient()` = assertAdmin).
 */
export async function updatePresenceVisibility(visibility: string): Promise<{ ok: boolean; error?: string }> {
  const next = PRESENCE_VISIBILITIES.find((v) => v === visibility);
  if (!next) return { ok: false, error: "Unknown visibility." };

  try {
    const { user, supabase } = await adminClient();
    const { error } = await supabase.from("profiles").update({ presence_visibility: next satisfies PresenceVisibility }).eq("id", user.id);
    if (error) throw error;
    // the storefront reads the filtered value through store_presence_for(); refresh the shell
    revalidateStore();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/**
 * What **one customer** sees: writes the caller's row in `admin_customer_visibility`
 * (migration 20), created automatically – with "last seen only" – when the customer
 * placed their first order. The admin can only ever write their own row: the id comes
 * from the session, the policy on the table checks it again.
 */
export async function updateCustomerVisibility(customerId: string, visibility: string): Promise<{ ok: boolean; error?: string }> {
  const next = PRESENCE_VISIBILITIES.find((v) => v === visibility);
  if (!next) return { ok: false, error: "Unknown visibility." };
  if (!UUID_RE.test(customerId)) return { ok: false, error: "Unknown customer." };

  try {
    const { user, supabase } = await adminClient();
    const { error } = await supabase
      .from("admin_customer_visibility")
      .upsert(
        { admin_id: user.id, customer_id: customerId, visibility: next satisfies PresenceVisibility, updated_at: new Date().toISOString() },
        { onConflict: "admin_id,customer_id" },
      );
    if (error) throw error;
    revalidateStore();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

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
  const money = formMoney(formData);
  const type: ProductType = str(formData, "type", 10) === "variable" ? "variable" : "simple";
  const isVariable = type === "variable";
  const sku = str(formData, "sku", 64).trim() || null;
  const brand = str(formData, "brand", 80).trim() || null;

  // Variable products: the axes the admin defined and one row per combination.
  const jsonField = (field: string, max: number) => {
    const raw = str(formData, field, max);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as unknown[]) : null;
    } catch {
      return null;
    }
  };
  const { attributes, attributeError } = parseAttributes(jsonField("attributes_json", 20000));
  const { variations, variationError } = parseVariations(jsonField("variations_json", 400000));

  const regularInput = str(formData, "regular_price", 20);
  const saleInput = str(formData, "sale_price", 20);
  const regularDisplayMicros = parseMoneyInput(regularInput);
  const saleDisplayMicros = parseMoneyInput(saleInput);
  const stock = Number(str(formData, "stock", 10) || "0");
  const isActive = bool(formData, "is_active");
  const isFeatured = bool(formData, "is_featured");
  const imageMode = str(formData, "image_mode", 10) || "keep";
  const imageUrlInput = str(formData, "image_url", 2000);
  const imageMediaId = str(formData, "image_media_id", 40);
  const galleryIds = [...new Set(str(formData, "gallery_ids", 2000).split(",").map((v) => v.trim()).filter(Boolean))];

  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (sku && sku.length > 64) fieldErrors.sku = "Keep the SKU under 64 characters.";
  if (brand && brand.length > 80) fieldErrors.brand = "Keep the brand under 80 characters.";
  if (attributeError) fieldErrors.attributes = attributeError;
  if (variationError) fieldErrors.variations = variationError;

  if (isVariable) {
    // The parent price/stock belong to the variations (a trigger keeps them in sync), so the
    // simple price fields are not part of a variable save.
    if (!fieldErrors.attributes && attributes.length === 0) {
      fieldErrors.attributes = "Add at least one attribute with one or more values (e.g. Color), then generate the variations.";
    }
    if (attributes.length && !variations.some((v) => attributes.every((a) => v.combination[a.name]))) {
      fieldErrors.variations = "Every variation must have a value for each attribute – regenerate the variations.";
    }
    if (!fieldErrors.variations && variations.some((v) => attributes.some((a) => !a.options.some((o) => o.toLowerCase() === String(v.combination[a.name]).toLowerCase())))) {
      fieldErrors.variations = "A variation uses a value that is not in its attribute – regenerate the variations.";
    }
    if (!fieldErrors.variations && variations.length === 0) fieldErrors.variations = "Generate at least one variation before saving.";
    if (!fieldErrors.variations && variations.some((v) => v.salePrice !== "" && v.regularPrice === "")) {
      fieldErrors.variations = "A sale price needs a regular price on the same variation.";
    }
    if (!fieldErrors.variations && variations.some((v) => v.regularPrice === "")) {
      fieldErrors.variations = "Set a regular price for every variation.";
    }
    if (!fieldErrors.variations && variations.some((v) => Number.isNaN(v.regularDisplay as number))) {
      fieldErrors.variations = "Enter a valid regular price for every variation.";
    }
    if (!fieldErrors.variations && variations.some((v) => v.saleDisplay !== null && Number.isNaN(v.saleDisplay))) {
      fieldErrors.variations = "Enter a valid sale price or leave it empty.";
    }
    if (!fieldErrors.variations && variations.some((v) => v.saleDisplay !== null && !Number.isNaN(v.saleDisplay) && v.saleDisplay >= (v.regularDisplay as number))) {
      fieldErrors.variations = "A sale price must be lower than the regular price.";
    }
    if (!fieldErrors.variations && variations.some((v) => !Number.isInteger(v.stockValue) || v.stockValue < 0)) {
      fieldErrors.variations = "Stock must be a whole number ≥ 0 for every variation.";
    }
    if (!fieldErrors.variations && !variations.some((v) => v.is_active && (v.regularDisplay ?? 0) > 0)) {
      fieldErrors.variations = "At least one enabled variation needs a regular price above 0.";
    }
  } else {
    if (!regularInput) {
      fieldErrors.regular_price = saleInput
        ? "A sale price needs a regular price – enter the regular price it discounts."
        : "Enter a regular price.";
    } else if (regularDisplayMicros === null || Number.isNaN(regularDisplayMicros)) {
      fieldErrors.regular_price = `Enter a valid regular price, e.g. ${inputFromMicros(DEFAULT_PRICE_MICROS, money)}.`;
    }
    if (Number.isNaN(saleDisplayMicros)) fieldErrors.sale_price = "Enter a valid sale price or leave it empty.";
    else if (saleDisplayMicros !== null && regularDisplayMicros !== null && !Number.isNaN(regularDisplayMicros) && saleDisplayMicros >= regularDisplayMicros) {
      fieldErrors.sale_price = "The sale price must be lower than the regular price.";
    }
    if (!Number.isInteger(stock) || stock < 0) fieldErrors.stock = "Stock must be a whole number ≥ 0.";
  }
  if (categoryId && !UUID_RE.test(categoryId)) fieldErrors.category_id = "Invalid category.";
  if (!["keep", "media", "url", "remove"].includes(imageMode)) fieldErrors.image_media_id = "Invalid image selection.";
  if (imageMode === "url" && !/^https?:\/\/\S+$/i.test(imageUrlInput)) fieldErrors.image_url = "Enter a full image URL starting with http:// or https://.";
  if (imageMode === "media" && !UUID_RE.test(imageMediaId)) fieldErrors.image_media_id = "Pick an image from the Media Library.";
  if (galleryIds.some((g) => !UUID_RE.test(g))) fieldErrors.gallery_ids = "Invalid gallery selection.";
  if (galleryIds.length > MAX_PRODUCT_GALLERY) fieldErrors.gallery_ids = `A gallery can hold at most ${MAX_PRODUCT_GALLERY} images.`;
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();

    // Prices the admin did not touch keep their stored USD micros exactly; edited ones are
    // converted back with the same rate the form displayed (a whole ৳ amount survives that
    // round trip because the base unit is a ten-thousandth of a cent).
    //
    // Stored shape: `price_micros` is what the customer pays, `compare_at_price_micros` the
    // regular price it discounts. Without a sale price the regular price is what you pay, so
    // the two are the same and nothing is struck through on the storefront.
    let regularMicros = toBaseMicros(regularDisplayMicros as number, money);
    let saleMicros = saleDisplayMicros === null ? null : toBaseMicros(saleDisplayMicros, money);
    if (isEdit) {
      const { data: current, error } = await supabase.from("products").select("id, price_micros, compare_at_price_micros").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!current) return { error: "This product no longer exists.", values };
      const currentRegular = (current.compare_at_price_micros as number | null) ?? (current.price_micros as number);
      const currentSale = current.compare_at_price_micros != null && (current.compare_at_price_micros as number) > (current.price_micros as number) ? (current.price_micros as number) : null;
      const shown = { regular: str(formData, "regular_price_shown", 20), sale: str(formData, "sale_price_shown", 20) };
      if (shown.regular && regularInput === shown.regular) regularMicros = currentRegular;
      if (saleInput === shown.sale) saleMicros = currentSale;
    }
    const priceMicros = saleMicros ?? regularMicros;
    const compareAtMicros = saleMicros !== null ? regularMicros : null;

    // ── resolve media-library references (must exist, be images, not trashed) ──
    const wanted = [
      ...new Set([
        ...(imageMode === "media" ? [imageMediaId] : []),
        ...galleryIds,
        ...variations.flatMap((v) => (v.image_media_id ? [v.image_media_id] : [])),
      ]),
    ];
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

    // A variable product's price/stock live on its variations: on update they are left alone
    // (the trigger owns them), on insert they start at 0 and the variations fill them in.
    const baseRow = {
      name,
      slug,
      description: description || null,
      category_id: categoryId || null,
      is_active: isActive,
      is_featured: isFeatured,
      type,
      sku,
      ...(isVariable
        ? isEdit
          ? {}
          : { price_micros: 0, compare_at_price_micros: null, stock: 0 }
        : { price_micros: priceMicros, compare_at_price_micros: compareAtMicros, stock }),
      ...image,
    };
    const row = { ...baseRow, brand };

    let result = isEdit
      ? await supabase.from("products").update(row).eq("id", id).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();
    if (
      result.error &&
      (result.error.code === "42703" || /column .*brand|schema cache/i.test(result.error.message ?? ""))
    ) {
      result = isEdit
        ? await supabase.from("products").update(baseRow).eq("id", id).select("id").single()
        : await supabase.from("products").insert(baseRow).select("id").single();
    }
    if (result.error) throw result.error;
    const productId = result.data.id as string;

    // ── variable products: replacement attributes + variations ──────────────
    if (isVariable) {
      await saveVariableProductSets(supabase, productId, attributes, variations, found, money);
    } else if (isEdit) {
      // Switching back to a simple product drops the variation matrix for good.
      const { error: attrError } = await supabase.from("product_attributes").delete().eq("product_id", productId);
      if (attrError) throw attrError;
      const { error: varError } = await supabase.from("product_variations").delete().eq("product_id", productId);
      if (varError) throw varError;
    }

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

/* ──────────────────────────────────────────────────────────────────────────
 * Variable products – parsing, validation and persistence
 * ────────────────────────────────────────────────────────────────────────── */

type ParsedAttribute = { name: string; options: string[] };
type ParsedVariation = SubmittedVariation & { regularDisplay: number | null; saleDisplay: number | null; stockValue: number };

/** Attribute list from the hidden `attributes_json` field. */
function parseAttributes(raw: unknown[] | null): { attributes: ParsedAttribute[]; attributeError?: string } {
  if (!raw) return { attributes: [] };
  const attributes: ParsedAttribute[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = String((entry as { name?: unknown }).name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const options = cleanOptions((((entry as { options?: unknown }).options as string[]) ?? []).map((v) => String(v)));
    if (!name && options.length === 0) continue; // an empty row the admin left behind
    if (!name) return { attributes: [], attributeError: "Give every attribute a name." };
    if (seen.has(name.toLowerCase())) return { attributes: [], attributeError: `“${name}” is used twice – every attribute needs its own name.` };
    seen.add(name.toLowerCase());
    if (!options.length) return { attributes: [], attributeError: `Add at least one value to “${name}”.` };
    if (options.length > MAX_ATTRIBUTE_OPTIONS) return { attributes: [], attributeError: `“${name}” can hold at most ${MAX_ATTRIBUTE_OPTIONS} values.` };
    attributes.push({ name, options });
  }
  if (attributes.length > MAX_ATTRIBUTES) return { attributes: [], attributeError: `A product can have at most ${MAX_ATTRIBUTES} attributes.` };
  return { attributes };
}

/** Variation list from the hidden `variations_json` field (prices are still display strings). */
function parseVariations(raw: unknown[] | null): { variations: ParsedVariation[]; variationError?: string } {
  if (!raw) return { variations: [] };
  if (raw.length > MAX_VARIATIONS) return { variations: [], variationError: `That is more than ${MAX_VARIATIONS} variations – reduce the attribute values.` };
  const variations: ParsedVariation[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<SubmittedVariation>;
    const combination: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.combination ?? {})) {
      const name = String(key ?? "").trim().slice(0, 60);
      const option = String(value ?? "").trim().slice(0, 60);
      if (name && option) combination[name] = option;
    }
    const signature = JSON.stringify(Object.entries(combination).sort(([a], [b]) => a.localeCompare(b)));
    if (seen.has(signature)) continue; // duplicates cannot be stored (unique index) – drop them quietly
    seen.add(signature);
    const regularPrice = String(row.regularPrice ?? "").trim();
    const salePrice = String(row.salePrice ?? "").trim();
    variations.push({
      id: row.id && UUID_RE.test(row.id) ? row.id : undefined,
      sku: String(row.sku ?? "").trim().slice(0, 64) || null,
      regularPrice,
      salePrice,
      stock: String(row.stock ?? "0").trim(),
      is_active: row.is_active !== false,
      image_media_id: row.image_media_id && UUID_RE.test(row.image_media_id) ? row.image_media_id : "",
      image_url: String(row.image_url ?? "").trim().slice(0, 2000),
      combination,
      regularDisplay: regularPrice === "" ? null : parseMoneyInput(regularPrice),
      saleDisplay: salePrice === "" ? null : parseMoneyInput(salePrice),
      stockValue: Number(String(row.stock ?? "0").trim() || "0"),
    });
  }
  return { variations };
}

/**
 * Writes the attributes and variations of a variable product: attributes are replaced as a
 * set, variations are updated in place when they already exist (their id survives, so any
 * order that references them keeps pointing at the same combination), inserted when they are
 * new, and the ones the admin removed are deleted. The `sync_variation_parent` trigger keeps
 * the product's own price/stock in step.
 */
async function saveVariableProductSets(
  supabase: Awaited<ReturnType<typeof adminClient>>["supabase"],
  productId: string,
  attributes: ParsedAttribute[],
  variations: ParsedVariation[],
  found: Map<string, { id: string; path: string }>,
  money: Money,
): Promise<void> {
  const { error: attrDeleteError } = await supabase.from("product_attributes").delete().eq("product_id", productId);
  if (attrDeleteError) throw attrDeleteError;
  if (attributes.length) {
    const { error } = await supabase
      .from("product_attributes")
      .insert(attributes.map((a, index) => ({ product_id: productId, name: a.name, options: a.options, sort_order: index })));
    if (error) throw error;
  }

  const names = attributes.map((a) => a.name);
  const rows = variations.map((v, index) => ({
    ...(v.id ? { id: v.id } : {}),
    product_id: productId,
    sku: v.sku,
    // the sale price is what the customer pays; the regular price is the struck-through one
    price_micros: v.saleDisplay !== null ? toBaseMicros(v.saleDisplay, money) : toBaseMicros(v.regularDisplay as number, money),
    compare_at_price_micros: v.saleDisplay !== null ? toBaseMicros(v.regularDisplay as number, money) : null,
    stock: Number.isInteger(v.stockValue) && v.stockValue >= 0 ? v.stockValue : 0,
    is_active: v.is_active,
    image_media_id: v.image_media_id || null,
    image_url: v.image_media_id ? mediaUrl(found.get(v.image_media_id)!.path) : v.image_url || null,
    combination: v.combination,
    label: combinationLabel(v.combination, names),
    sort_order: index,
  }));

  // 1. drop the rows the admin removed, *before* writing the new ones (their order items keep
  //    the label they copied at checkout), 2. update the rows that still exist in place,
  //    3. insert the combinations that were added.
  const keepIds = variations.flatMap((v) => (v.id ? [v.id] : []));
  const remove = supabase.from("product_variations").delete().eq("product_id", productId);
  const { error: removeError } = keepIds.length ? await remove.not("id", "in", `(${keepIds.join(",")})`) : await remove;
  if (removeError) throw removeError;

  const updates = rows.filter((r) => "id" in r);
  const inserts = rows.filter((r) => !("id" in r));
  if (updates.length) {
    const { error } = await supabase.from("product_variations").upsert(updates, { onConflict: "id" });
    if (error) throw error;
  }
  if (inserts.length) {
    const { error } = await supabase.from("product_variations").insert(inserts);
    if (error) throw error;
  }
}

export async function toggleProductFeatured(
  id: string,
  featured: boolean,
): Promise<{ ok: boolean; is_featured?: boolean; message?: string; error?: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid product id." };
  try {
    const { supabase } = await adminClient();
    const { data: product, error } = await supabase
      .from("products")
      .update({ is_featured: Boolean(featured) })
      .eq("id", id)
      .select("id, name, is_featured")
      .maybeSingle();
    if (error) throw error;
    if (!product) return { ok: false, error: "Product not found." };

    revalidateStore();
    return {
      ok: true,
      is_featured: Boolean(product.is_featured),
      message: product.is_featured
        ? `"${product.name}" marked as featured.`
        : `"${product.name}" removed from featured.`,
    };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
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

/**
 * One image column pair (`<name>_mode` = keep | media | url | remove,
 * `<name>_media_id`, `<name>_url`) → the `image_url` / `image_media_id` to write.
 * The library id is resolved server-side; nothing the browser sends is trusted.
 */
async function resolveImageChoice(
  formData: FormData,
  name: string,
  fieldErrors: Record<string, string>,
): Promise<{ image_url?: string | null; image_media_id?: string | null }> {
  const mode = str(formData, `${name}_mode`, 10) || "keep";
  const mediaId = str(formData, `${name}_media_id`, 40);
  const url = str(formData, `${name}_url`, 2000);

  if (mode === "remove") return { image_url: null, image_media_id: null };
  if (mode === "url") {
    if (!/^https?:\/\/\S+$/i.test(url)) {
      fieldErrors[`${name}_url`] = "Enter a full image URL starting with http:// or https://.";
      return {};
    }
    return { image_url: url, image_media_id: null };
  }
  if (mode !== "media") return {};
  if (!UUID_RE.test(mediaId)) {
    fieldErrors[`${name}_media_id`] = "Pick an image from the Media Library.";
    return {};
  }

  const { supabase } = await adminClient();
  const { data, error } = await supabase.from("media").select("id, path, kind, deleted_at").eq("id", mediaId).maybeSingle();
  if (error) throw error;
  const item = data as { id: string; path: string; kind: string; deleted_at: string | null } | null;
  if (!item || item.deleted_at || item.kind !== "image") {
    fieldErrors[`${name}_media_id`] = "That image is no longer in the Media Library – pick another one.";
    return {};
  }
  return { image_url: mediaUrl(item.path), image_media_id: item.id };
}

export async function saveCategory(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid category id.", values };

  const name = str(formData, "name", 100);
  const slug = slugify(str(formData, "slug", 100) || name);
  const iconInput = str(formData, "icon", 40);
  const iconColorInput = str(formData, "icon_color", 20).trim();
  // "Remove icon": only stored when no icon is picked – the picture then carries the tile.
  const iconDisabledInput = bool(formData, "icon_disabled");

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Use lowercase letters, numbers and dashes only.";
  if (iconInput && !isCategoryIconId(iconInput)) fieldErrors.icon = "Pick one of the available icons.";
  if (iconColorInput && !/^#[0-9a-f]{6}$/i.test(iconColorInput)) fieldErrors.icon_color = "Pick a fill colour, or clear it for the theme primary.";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();
    const image = await resolveImageChoice(formData, "image", fieldErrors);
    if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

    const row = {
      name,
      slug,
      icon: iconInput || null,
      icon_color: iconColorInput ? iconColorInput.toLowerCase() : null,
      icon_disabled: iconDisabledInput && !iconInput,
      ...image,
    };
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

/** Bulk delete from the categories table ("N selected → Delete"). */
export async function deleteCategories(formData: FormData): Promise<void> {
  const back = returnTo(formData, "/nemesis/categories");
  const ids = idsFrom(formData);
  if (ids.length === 0) redirect(failure(back, "Select at least one category first."));
  try {
    const { supabase } = await adminClient();
    // products.category_id is `on delete set null` → products survive, uncategorised
    const { data, error } = await supabase.from("categories").delete().in("id", ids).select("id");
    if (error) throw error;
    const deleted = data ?? [];
    if (deleted.length === 0) redirect(failure(back, "Those categories no longer exist."));

    updateTag(MENU_TAG); // menu items that link to a deleted category go with it
    revalidateStore();
    redirect(notice(back, `${count(deleted.length, "category", "categories")} deleted. Their products are now uncategorised.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
  }
}

/** "Delete all" – every category at once, from any page of the list. */
export async function deleteAllCategories(formData: FormData): Promise<void> {
  const back = returnTo(formData, "/nemesis/categories");
  try {
    const { supabase } = await adminClient();
    const { data, error } = await supabase.from("categories").delete().neq("id", "00000000-0000-0000-0000-000000000000").select("id");
    if (error) throw error;
    const deleted = data ?? [];
    if (deleted.length === 0) redirect(failure(back, "There are no categories to delete."));

    updateTag(MENU_TAG); // every menu item that linked to a category is gone with it
    revalidateStore();
    redirect(notice(back, `${count(deleted.length, "category", "categories")} deleted. Their products are now uncategorised.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, friendlyError(e)));
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

    // Keep the auth metadata in step with the profile, so anything reading the token
    // (Supabase tooling, a fresh client) sees the same name. Best effort: without the
    // service key the profile is still the source of truth for the app.
    const service = createServiceClient();
    if (service) {
      await service.auth.admin.updateUserById(id, { user_metadata: { full_name: fullName || null } }).catch(() => undefined);
    }

    revalidateStore();
    return { success: "User updated." };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/**
 * Creates an account from the dashboard (the "New user" dialog on Users).
 *
 * Accounts cannot be inserted through RLS: the row has to live in `auth.users` with a
 * hashed password, so this goes through Supabase's **Admin API** with the service-role
 * key (`SUPABASE_SERVICE_ROLE_KEY`, server-side only). `adminClient()` runs first and
 * throws unless the caller is an admin, and only then is the service client used.
 *
 * The address is confirmed on creation (`email_confirm: true`) – the admin is setting a
 * password by hand and will pass it on, so there is nothing to confirm by e-mail. The
 * `on_auth_user_created` trigger writes the profile row (full name from the metadata);
 * phone + role are filled in right after.
 */
export async function createUser(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  // Never echo a password back into the page.
  delete values.password;

  const fullName = str(formData, "full_name", 120);
  const email = str(formData, "email", 254).toLowerCase();
  const phone = str(formData, "phone", 40);
  const role = str(formData, "role", 20) === "admin" ? "admin" : "customer";
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";

  const fieldErrors: Record<string, string> = {};
  if (!fullName) fieldErrors.full_name = "Enter the full name.";
  if (!email) fieldErrors.email = "Enter an e-mail address.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Enter a valid e-mail address.";
  const problem = passwordProblem(password);
  if (problem) fieldErrors.password = problem;
  if (Object.keys(fieldErrors).length > 0) return { error: "Check the highlighted fields.", fieldErrors, values };

  try {
    const { supabase } = await adminClient();
    const service = createServiceClient();
    if (!service) {
      return {
        error: "Creating users needs SUPABASE_SERVICE_ROLE_KEY in the server environment (Dashboard → Project Settings → API → secret key, then redeploy).",
        values,
      };
    }

    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "email_exists" || code === "user_already_exists" || /already (been )?(registered|exists)/i.test(error.message)) {
        return { error: "That e-mail already has an account.", fieldErrors: { email: "That e-mail already has an account." }, values };
      }
      throw error;
    }

    const created = data.user;
    if (!created) throw new Error("Supabase did not return the new user.");

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: phone || null, is_admin: role === "admin" })
      .eq("id", created.id);
    if (profileError) throw profileError;

    revalidateStore();
    return { success: `${fullName} was created — ${email} can sign in with the password you set.` };
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

const META_FALLBACK_KEYS = [
  "footer_text",
  "shipping_enabled",
  "shipping_rate_micros",
  "home_show_hero",
  "home_hero_badge",
  "home_hero_title",
  "home_hero_subtitle",
  "home_hero_primary_cta_text",
  "home_hero_primary_cta_href",
  "home_hero_secondary_cta_text",
  "home_hero_secondary_cta_href",
  "home_show_category_sections",
] as const;

/** Writes `patch` onto the single settings row and refreshes everything that renders it. */
async function saveSiteSettings(patch: Record<string, unknown>): Promise<string | null> {
  const { supabase } = await adminClient();
  let { data, error } = await supabase.from("site_settings").update(patch).eq("id", 1).select("id").maybeSingle();
  if (error) {
    if (error.code === "42703" || /column .* does not exist|schema cache/i.test(error.message ?? "")) {
      const message = error.message ?? "";
      if (/footer_text|shipping_|home_show_hero|home_hero_|home_show_category_sections/i.test(message)) {
        const { data: current } = await supabase.from("site_settings").select("theme_gradients").eq("id", 1).maybeSingle();
        const existingGradients =
          current?.theme_gradients && typeof current.theme_gradients === "object" && !Array.isArray(current.theme_gradients)
            ? { ...(current.theme_gradients as Record<string, unknown>) }
            : {};
        const fallbackPatch: Record<string, unknown> = { ...patch };
        for (const k of META_FALLBACK_KEYS) {
          if (k in fallbackPatch) {
            existingGradients[k] = fallbackPatch[k];
            delete fallbackPatch[k];
          }
        }
        fallbackPatch.theme_gradients = existingGradients;
        const retry = await supabase.from("site_settings").update(fallbackPatch).eq("id", 1).select("id").maybeSingle();
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        const errMsg = error.message ?? "";
        const migration = /footer_text/i.test(errMsg)
          ? "20261037000000_footer_text.sql"
          : /shipping_/i.test(errMsg)
            ? "20261036000000_shipping_settings.sql"
            : /currency|bdt_rate/i.test(errMsg)
              ? "20261025000000_currency.sql"
              : /home_/i.test(errMsg)
                ? "20261024000000_home_sections.sql"
                : /media_id/i.test(errMsg)
                  ? "20261020000000_single_media_bucket.sql"
                  : "20261018000000_settings_tabs.sql";
        return `The database is missing the new settings columns – run supabase/migrations/${migration} in the Supabase SQL Editor.`;
      }
    } else {
      throw error;
    }
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
  const footerText = str(formData, "footer_text", 160);
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
      ...(formData.has("footer_text") ? { footer_text: footerText || null } : {}),
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
  const currencyInput = str(formData, "currency", 10);
  const currency = isCurrencyCode(currencyInput) ? currencyInput : null;
  const rateInput = str(formData, "usd_to_bdt_rate", 20);
  const shippingEnabled = formData.has("shipping_enabled") ? bool(formData, "shipping_enabled") : true;
  const shippingRateInput = str(formData, "shipping_rate", 20);
  const fieldErrors: Record<string, string> = {};
  if (!currency) fieldErrors.currency = "Pick USD or BDT.";
  // The rate only matters (and is only shown) for BDT; a USD store keeps the last rate for later.
  const rate = currency === "BDT" ? parseExchangeRate(rateInput) : null;
  if (currency === "BDT" && (rate === null || Number.isNaN(rate))) fieldErrors.usd_to_bdt_rate = `Enter how many BDT one USD is worth, e.g. 120 (up to ${MAX_EXCHANGE_RATE.toLocaleString("en-US")}).`;

  let shippingRateMicros: number | null = null;
  if (shippingEnabled && formData.has("shipping_rate")) {
    const minor = parseMoneyInput(shippingRateInput);
    if (minor === null || Number.isNaN(minor) || minor < 0) {
      fieldErrors.shipping_rate = "Enter a valid shipping rate (0 or higher).";
    } else {
      const effectiveMoney: Money = currency === "BDT" && rate && !Number.isNaN(rate) ? { currency: "BDT", rate } : USD_MONEY;
      shippingRateMicros = toBaseMicros(minor, effectiveMoney);
    }
  }

  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };
  try {
    const problem = await saveSiteSettings({
      manage_stock: manageStock,
      currency,
      ...(rate ? { usd_to_bdt_rate: rate } : {}),
      shipping_enabled: shippingEnabled,
      ...(shippingRateMicros !== null ? { shipping_rate_micros: shippingRateMicros } : {}),
    });
    if (problem) return { error: problem, values };
    return { success: "Setting Saved", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/**
 * UI → Home page: which sections the storefront home renders + the heading of the
 * filtered-products section. Lives on the single `site_settings` row, so the home page
 * (static shell, tagged) picks the change up immediately.
 */
export async function updateHomeSections(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const heroBadge = str(formData, "home_hero_badge", HOME_HERO_BADGE_MAX + 1);
  const heroTitle = str(formData, "home_hero_title", HOME_HERO_TITLE_MAX + 1);
  const heroSubtitle = str(formData, "home_hero_subtitle", HOME_HERO_SUBTITLE_MAX + 1);
  const primaryCtaText = str(formData, "home_hero_primary_cta_text", HOME_HERO_CTA_TEXT_MAX + 1);
  const primaryCtaHref = str(formData, "home_hero_primary_cta_href", HOME_HERO_CTA_HREF_MAX + 1);
  const secondaryCtaText = str(formData, "home_hero_secondary_cta_text", HOME_HERO_CTA_TEXT_MAX + 1);
  const secondaryCtaHref = str(formData, "home_hero_secondary_cta_href", HOME_HERO_CTA_HREF_MAX + 1);
  const title = str(formData, "home_filter_title", HOME_FILTER_TITLE_MAX + 1);

  const fieldErrors: Record<string, string> = {};
  if (heroBadge.length > HOME_HERO_BADGE_MAX) {
    fieldErrors.home_hero_badge = `Keep the badge text under ${HOME_HERO_BADGE_MAX} characters.`;
  }
  if (heroTitle.length > HOME_HERO_TITLE_MAX) {
    fieldErrors.home_hero_title = `Keep the hero heading under ${HOME_HERO_TITLE_MAX} characters.`;
  }
  if (heroSubtitle.length > HOME_HERO_SUBTITLE_MAX) {
    fieldErrors.home_hero_subtitle = `Keep the hero description under ${HOME_HERO_SUBTITLE_MAX} characters.`;
  }
  if (primaryCtaText.length > HOME_HERO_CTA_TEXT_MAX) {
    fieldErrors.home_hero_primary_cta_text = `Keep the primary button text under ${HOME_HERO_CTA_TEXT_MAX} characters.`;
  }
  if (primaryCtaHref.length > HOME_HERO_CTA_HREF_MAX) {
    fieldErrors.home_hero_primary_cta_href = `Keep the primary button link under ${HOME_HERO_CTA_HREF_MAX} characters.`;
  }
  if (secondaryCtaText.length > HOME_HERO_CTA_TEXT_MAX) {
    fieldErrors.home_hero_secondary_cta_text = `Keep the secondary link text under ${HOME_HERO_CTA_TEXT_MAX} characters.`;
  }
  if (secondaryCtaHref.length > HOME_HERO_CTA_HREF_MAX) {
    fieldErrors.home_hero_secondary_cta_href = `Keep the secondary link URL under ${HOME_HERO_CTA_HREF_MAX} characters.`;
  }
  if (title.length > HOME_FILTER_TITLE_MAX) {
    fieldErrors.home_filter_title = `Keep the title under ${HOME_FILTER_TITLE_MAX} characters.`;
  }
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  try {
    const problem = await saveSiteSettings({
      home_show_hero: formData.has("home_show_hero") ? bool(formData, "home_show_hero") : true,
      home_hero_badge: heroBadge || null,
      home_hero_title: heroTitle || null,
      home_hero_subtitle: heroSubtitle || null,
      home_hero_primary_cta_text: primaryCtaText || null,
      home_hero_primary_cta_href: primaryCtaHref || null,
      home_hero_secondary_cta_text: secondaryCtaText || null,
      home_hero_secondary_cta_href: secondaryCtaHref || null,
      home_show_categories: bool(formData, "home_show_categories"),
      home_show_category_sections: formData.has("home_show_category_sections") ? bool(formData, "home_show_category_sections") : true,
      home_show_featured: bool(formData, "home_show_featured"),
      home_show_filter: bool(formData, "home_show_filter"),
      home_filter_title: title || null,
    });
    if (problem) return { error: problem, values };
    return { success: "Home page sections saved.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Extra → Theme Customization
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Reads one of the theme JSON fields. Anything the colour helpers do not accept is dropped
 * (the field simply keeps its template value), so a bad payload can never break the CSS.
 */
function parseThemeJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Theme Customization (Extra tab): both palettes, the gradients and the sync switch
 * in one save. Colours are validated here before they reach the database, and the
 * whole page is refreshed with the new look.
 */
export async function updateTheme(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  try {
    const light: ThemeColors = normaliseColors(parseThemeJson(str(formData, "theme_light", 20000)));
    const darkInput: ThemeColors = normaliseColors(parseThemeJson(str(formData, "theme_dark", 20000)));
    const gradients: ThemeGradientSets = normaliseGradients(parseThemeJson(str(formData, "theme_gradients", 20000)));
    const sync = bool(formData, "theme_sync");

    const { supabase } = await adminClient();
    const { data: current } = await supabase.from("site_settings").select("theme_gradients").eq("id", 1).maybeSingle();
    const existingGradients =
      current?.theme_gradients && typeof current.theme_gradients === "object" && !Array.isArray(current.theme_gradients)
        ? (current.theme_gradients as Record<string, unknown>)
        : {};
    const mergedGradients: Record<string, unknown> = { ...gradients };
    for (const k of META_FALLBACK_KEYS) {
      if (k in existingGradients) mergedGradients[k] = existingGradients[k];
    }

    const problem = await saveSiteSettings({
      theme_light: light,
      // With "use the same colors for both modes" on, the dark palette mirrors the light one
      // (stored, not just rendered, so switching the option off later keeps them in step).
      theme_dark: sync ? light : darkInput,
      theme_gradients: mergedGradients,
      theme_sync: sync,
    });
    if (problem) return { error: problem, values };
    return { success: sync ? "Theme saved – both modes use the same colors." : "Theme saved.", values };
  } catch (e) {
    return { error: friendlyError(e), values };
  }
}

/* `redirect()` works by throwing – make sure our catch blocks let it through. */
