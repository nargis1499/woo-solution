import "server-only";
import { MEDIA_REF_COLUMNS, isMissingMediaSchema, withSortedGallery } from "@/lib/media/shared";
import { createClient } from "@/lib/supabase/server";
import { BASE_ORDER_COLUMNS, ORDER_COLUMNS, ORDER_ITEM_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY, withOrderColumns } from "@/lib/data/order-columns";
import { isMissingBrandColumn, isMissingVariationSchema } from "@/lib/data/product-columns";
import { withSortedVariations } from "@/lib/variations";
import { requireAdmin } from "@/lib/admin/auth";
import { ORDER_STATUSES } from "@/lib/admin/constants";
import { pageCount } from "@/lib/admin/pagination";
import { normaliseSiteSettings } from "@/lib/site-settings";
import { PAGE_COLUMNS, PAGE_DETAIL_COLUMNS, withTags } from "@/lib/data/pages";
import { categoryColumnSets, isMissingCategoryColumn } from "@/lib/data/category-columns";
import type { PageSort } from "@/lib/pages/shared";
import type { AdminStats, Category, MediaRef, MenuItem, MenuLocation, Order, OrderStatus, Page, PageStatus, Product, Profile, SettingsMedia, SiteSettingsRow, Tag } from "@/lib/types";

/*
 * Admin read models. Every helper calls `requireAdmin()` first (cheap – the
 * lookup is memoised per request) and, independently, Row Level Security only
 * returns the full data set to admins. Belt and braces.
 */

const PRODUCT_COLUMNS_BASE =
  "id, category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, stock, is_active, is_featured, created_at, updated_at, category:categories(id, name, slug)";
/** `type` / `sku` + the variation tables came with migration 14; `brand`, `features`, and `quick_checkout` came with migrations 25–27. */
const PRODUCT_COLUMNS = `${PRODUCT_COLUMNS_BASE}, type, sku, brand, features, quick_checkout`;
const PRODUCT_COLUMNS_NO_BRAND = `${PRODUCT_COLUMNS_BASE}, type, sku`;

/** Media-library embeds (main image + ordered gallery). Only used where the form needs them. */
const PRODUCT_MEDIA_COLUMNS = `${PRODUCT_COLUMNS}, image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;
const PRODUCT_MEDIA_COLUMNS_NO_BRAND = `${PRODUCT_COLUMNS_NO_BRAND}, image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;

/** Product form: the media embeds plus the variable-product tables. */
const PRODUCT_VARIATION_COLUMNS = `${PRODUCT_MEDIA_COLUMNS}, attributes:product_attributes(id, product_id, name, options, is_quantity, sort_order), variations:product_variations(id, product_id, sku, price_micros, compare_at_price_micros, stock, is_active, image_url, image_media_id, combination, label, sort_order, image_media:media!product_variations_image_media_id_fkey(${MEDIA_REF_COLUMNS}))`;
const PRODUCT_VARIATION_COLUMNS_NO_BRAND = `${PRODUCT_MEDIA_COLUMNS_NO_BRAND}, attributes:product_attributes(id, product_id, name, options, sort_order), variations:product_variations(id, product_id, sku, price_micros, compare_at_price_micros, stock, is_active, image_url, image_media_id, combination, label, sort_order, image_media:media!product_variations_image_media_id_fkey(${MEDIA_REF_COLUMNS}))`;

/** Without `type` / `sku`, for a database that has not run migration 14 yet. */
const PRODUCT_COLUMNS_LEGACY = PRODUCT_COLUMNS_BASE;
const PRODUCT_MEDIA_COLUMNS_LEGACY = `${PRODUCT_COLUMNS_BASE}, image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;


const PROFILE_COLUMNS = "id, full_name, phone, email, avatar_url, is_admin, created_at, updated_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/* ─── Pagination ─────────────────────────────────────────────────────────────
 * Lists count first, clamp the requested page to what exists, then fetch that
 * page with `.range()`. The caller compares `page` with what it asked for and
 * redirects when they differ, so the URL always matches the rows on screen.
 */
export type PageRequest = { page?: number; perPage?: number };
export type ListPage<T> = { items: T[]; total: number; page: number; perPage: number };

function pageWindow(req: PageRequest, total: number) {
  const perPage = Math.max(1, req.perPage ?? 10);
  const page = Math.min(Math.max(1, req.page ?? 1), pageCount(total, perPage));
  const from = (page - 1) * perPage;
  return { perPage, page, from, to: from + perPage - 1 };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function adminGetStats(): Promise<AdminStats> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats");
  if (error) throw new Error(`Failed to load statistics: ${error.message}`);
  return data as AdminStats;
}

export async function adminGetRecentOrders(limit = 6): Promise<Order[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await withOrderColumns((columns) =>
    supabase.from("orders").select(`${columns}, order_items(id, quantity)`).order("created_at", { ascending: false }).limit(limit),
  );
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return (data ?? []) as unknown as Order[];
}

export async function adminGetLowStockProducts(limit = 6): Promise<Product[]> {
  await requireAdmin();
  const supabase = await createClient();
  const run = (columns: string) =>
    supabase
      .from("products")
      .select(columns)
      .eq("is_active", true)
      .lte("stock", 5)
      .order("stock", { ascending: true })
      .limit(limit);
  let { data, error } = await run(PRODUCT_COLUMNS);
  if (error && isMissingBrandColumn(error)) ({ data, error } = await run(PRODUCT_COLUMNS_NO_BRAND));
  if (error && isMissingVariationSchema(error)) ({ data, error } = await run(PRODUCT_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []) as unknown as Product[];
}

// ─── Products ───────────────────────────────────────────────────────────────

export type ProductListOptions = PageRequest & { q?: string; category?: string };

/** One page of the admin product list plus the total for the same filter (drives the pager). */
export async function adminListProducts(options: ProductListOptions = {}): Promise<ListPage<Product>> {
  await requireAdmin();
  const supabase = await createClient();
  const search = options.q ? `name.ilike.%${escapeLike(options.q)}%,slug.ilike.%${escapeLike(options.q)}%` : null;
  const categoryId = options.category && isUuid(options.category) ? options.category : null;
  const build = (columns: string, head: boolean) => {
    let q = supabase.from("products").select(columns, { count: "exact", head });
    if (search) q = q.or(search);
    if (categoryId) q = q.eq("category_id", categoryId);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load products: ${countError.message}`);
  const total = count ?? 0;
  const { perPage, page, from, to } = pageWindow(options, total);

  const run = (columns: string) =>
    build(columns, false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // stable order for rows created in the same instant (e.g. seed data)
      .range(from, to);

  let { data, error } = await run(PRODUCT_COLUMNS);
  if (error && isMissingBrandColumn(error)) ({ data, error } = await run(PRODUCT_COLUMNS_NO_BRAND));
  if (error && isMissingVariationSchema(error)) ({ data, error } = await run(PRODUCT_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return { items: (data ?? []) as unknown as Product[], total, page, perPage };
}

export async function adminGetProduct(id: string): Promise<Product | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const load = (columns: string) => supabase.from("products").select(columns).eq("id", id).maybeSingle();
  let { data, error } = await load(PRODUCT_VARIATION_COLUMNS);
  if (error && isMissingBrandColumn(error)) ({ data, error } = await load(PRODUCT_VARIATION_COLUMNS_NO_BRAND));
  if (error && /product_variations|product_attributes/i.test(`${error.message} ${error.code}`)) ({ data, error } = await load(PRODUCT_MEDIA_COLUMNS_LEGACY));
  // Before the media migration ran the embeds don't resolve – fall back to the plain row.
  if (error && isMissingMediaSchema(error.message)) ({ data, error } = await load(PRODUCT_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? withSortedVariations(withSortedGallery(data as unknown as Product)) : null;
}

/** Simple products selectable inside the Pages Block Editor ("Simple Product" block). */
export async function adminListSimpleProducts(): Promise<Product[]> {
  await requireAdmin();
  const supabase = await createClient();
  const run = (columns: string, filterSimple: boolean) => {
    let q = supabase
      .from("products")
      .select(columns)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(500);
    if (filterSimple) q = q.eq("type", "simple");
    return q;
  };
  let { data, error } = await run(PRODUCT_COLUMNS, true);
  if (error && isMissingBrandColumn(error)) {
    ({ data, error } = await run(PRODUCT_COLUMNS_NO_BRAND, true));
  }
  if (error && isMissingVariationSchema(error)) {
    ({ data, error } = await run(PRODUCT_COLUMNS_LEGACY, false));
  }
  if (error) throw new Error(`Failed to load simple products: ${error.message}`);
  return ((data ?? []) as unknown as Product[]).filter((p) => (p.type ?? "simple") === "simple");
}

// ─── Pages (CMS) ────────────────────────────────────────────────────────────

export type PageListOptions = PageRequest & { q?: string; status?: PageStatus | ""; sort?: PageSort };

/** List columns: no content (can be large), but the featured image thumbnail, the author and the tags. */
const PAGE_LIST_COLUMNS = `${PAGE_COLUMNS.replace("content, ", "")}, featured_image:media!pages_featured_image_id_fkey(${MEDIA_REF_COLUMNS}), author:profiles(id, full_name, email), tags:page_tags(position, tag:tags(id, name, slug))`;

const PAGE_FORM_COLUMNS = `${PAGE_DETAIL_COLUMNS}, author:profiles(id, full_name, email)`;

/** One page of the admin pages list plus the total for the same filter (drives the pager). */
export async function adminListPages(options: PageListOptions = {}): Promise<ListPage<Page>> {
  await requireAdmin();
  const supabase = await createClient();
  const search = options.q ? `title.ilike.%${escapeLike(options.q)}%,slug.ilike.%${escapeLike(options.q)}%` : null;
  const build = (columns: string, head: boolean) => {
    let q = supabase.from("pages").select(columns, { count: "exact", head });
    if (search) q = q.or(search);
    if (options.status) q = q.eq("status", options.status);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load pages: ${countError.message}`);
  const total = count ?? 0;
  const { perPage, page, from, to } = pageWindow(options, total);

  let query = build(PAGE_LIST_COLUMNS, false);
  switch (options.sort ?? "updated_desc") {
    case "created_desc":
      query = query.order("created_at", { ascending: false });
      break;
    case "published_desc":
      query = query.order("published_at", { ascending: false, nullsFirst: false });
      break;
    case "title_asc":
      query = query.order("title", { ascending: true });
      break;
    case "title_desc":
      query = query.order("title", { ascending: false });
      break;
    default:
      query = query.order("updated_at", { ascending: false });
  }
  const { data, error } = await query.order("id", { ascending: false }).range(from, to);
  if (error) throw new Error(`Failed to load pages: ${error.message}`);
  return { items: ((data ?? []) as unknown as Page[]).map((p) => withTags(p) as Page), total, page, perPage };
}

export async function adminGetPage(id: string): Promise<Page | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("pages").select(PAGE_FORM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load page: ${error.message}`);
  return data ? (withTags(data as unknown as Page) as Page) : null;
}

/** Every tag, A → Z (suggestions in the page form). */
export async function adminListTags(): Promise<Tag[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("tags").select("id, name, slug").order("name", { ascending: true }).limit(1000);
  if (error) {
    // the pages migration has not run yet – the form still works without suggestions
    if (/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)) return [];
    throw new Error(`Failed to load tags: ${error.message}`);
  }
  return (data ?? []) as Tag[];
}

// ─── Categories ─────────────────────────────────────────────────────────────

/**
 * One page of the categories list plus the total for the same rows (drives the pager).
 * Everything that needs *all* categories (product form dropdown, shop filters, the
 * storefront) keeps using `adminListCategories()` below.
 */
export async function adminListCategoriesPage(options: PageRequest = {}): Promise<ListPage<Category>> {
  await requireAdmin();
  const supabase = await createClient();
  type Row = Category & { products?: { count: number }[] };

  // count first, so a page number past the end can be clamped before fetching
  const counted = await supabase.from("categories").select("id", { count: "exact", head: true });
  if (counted.error) throw new Error(`Failed to load categories: ${counted.error.message}`);
  const { perPage, page, from, to } = pageWindow(options, counted.count ?? 0);

  type Result = { data: unknown; error: { message: string; code?: string } | null };
  let result: Result = { data: null, error: null };
  for (const columns of categoryColumnSets(", products(count)")) {
    result = (await supabase
      .from("categories")
      .select(columns, { count: "exact" })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .range(from, to)) as Result;
    if (!result.error) break;
    if (!isMissingCategoryColumn(result.error)) break;
  }
  if (result.error) throw new Error(`Failed to load categories: ${result.error.message}`);
  const rows = (result.data ?? []) as Row[];
  return {
    items: rows.map(({ products, ...c }) => ({ ...c, product_count: products?.[0]?.count ?? 0 })),
    total: counted.count ?? 0,
    page,
    perPage,
  };
}

export async function adminListCategories(): Promise<Category[]> {
  await requireAdmin();
  const supabase = await createClient();
  type Row = Category & { products?: { count: number }[] };

  let rows: Row[] | null = null;
  let error: { message: string } | null = null;
  for (const columns of categoryColumnSets(", products(count)")) {
    const result = await supabase
      .from("categories")
      .select(columns)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    error = result.error;
    if (!error) { rows = (result.data ?? []) as unknown as Row[]; break; }
    if (!isMissingCategoryColumn(error)) break;
  }
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  return (rows ?? []).map(({ products, ...c }) => ({ ...c, product_count: products?.[0]?.count ?? 0 }));
}

export async function adminGetCategory(id: string): Promise<Category | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  type Row = Category & { products?: { count: number }[] };

  let row: Row | null = null;
  let error: { message: string } | null = null;
  for (const columns of categoryColumnSets(", products(count)")) {
    const result = await supabase.from("categories").select(columns).eq("id", id).maybeSingle();
    error = result.error;
    if (!error) { row = (result.data ?? null) as Row | null; break; }
    if (!isMissingCategoryColumn(error)) break;
  }
  if (error) throw new Error(`Failed to load category: ${error.message}`);
  if (!row) return null;
  const { products, ...c } = row;
  return { ...c, product_count: products?.[0]?.count ?? 0 };
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export type OrderListOptions = PageRequest & { status?: string; q?: string };

export async function adminListOrders(options: OrderListOptions = {}): Promise<ListPage<Order>> {
  await requireAdmin();
  const supabase = await createClient();
  const status = options.status && ORDER_STATUSES.includes(options.status as OrderStatus) ? options.status : null;
  let search: string | null = null;
  if (options.q) {
    const term = `%${escapeLike(options.q)}%`;
    const asNumber = Number(options.q.replace(/^#/, ""));
    const parts = [`shipping_name.ilike.${term}`, `customer_email.ilike.${term}`];
    if (Number.isInteger(asNumber) && asNumber > 0) parts.push(`order_number.eq.${asNumber}`);
    search = parts.join(",");
  }
  const build = (columns: string, head: boolean) => {
    let q = supabase.from("orders").select(columns, { count: "exact", head });
    if (status) q = q.eq("status", status);
    if (search) q = q.or(search);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load orders: ${countError.message}`);
  const total = count ?? 0;
  const { perPage, page, from, to } = pageWindow(options, total);

  const { data, error } = await withOrderColumns((columns) =>
    build(`${columns}, order_items(id, quantity)`, false)
      .order("created_at", { ascending: false })
      .order("order_number", { ascending: false })
      .range(from, to),
  );
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return { items: (data ?? []) as unknown as Order[], total, page, perPage };
}

export async function adminGetOrder(id: string): Promise<Order | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const load = (orderColumns: string, itemColumns: string) =>
    supabase
      .from("orders")
      .select(`${orderColumns}, order_items(${itemColumns})`)
      .eq("id", id)
      .maybeSingle();
  let { data, error } = await load(ORDER_COLUMNS, ORDER_ITEM_COLUMNS);
  if (error && /variation_(id|label)/i.test(`${error.message} ${error.code}`)) ({ data, error } = await load(ORDER_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY));
  if (error && /exchange_rate/i.test(`${error.message} ${error.code}`)) ({ data, error } = await load(BASE_ORDER_COLUMNS, ORDER_ITEM_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  return (data as unknown as Order) ?? null;
}


// ─── Users ──────────────────────────────────────────────────────────────────

export type ProfileWithOrders = Profile & { order_count: number; total_spent_micros: number; orders?: Order[] };

export type UserListOptions = PageRequest & { q?: string };

export async function adminListUsers(options: UserListOptions = {}): Promise<ListPage<ProfileWithOrders>> {
  await requireAdmin();
  const supabase = await createClient();
  const search = options.q
    ? `full_name.ilike.%${escapeLike(options.q)}%,email.ilike.%${escapeLike(options.q)}%,phone.ilike.%${escapeLike(options.q)}%`
    : null;
  const build = (columns: string, head: boolean) => {
    let q = supabase.from("profiles").select(columns, { count: "exact", head });
    if (search) q = q.or(search);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load users: ${countError.message}`);
  const total = count ?? 0;
  const { perPage, page, from, to } = pageWindow(options, total);

  const { data, error } = await build(PROFILE_COLUMNS, false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) throw new Error(`Failed to load users: ${error.message}`);
  const profiles = (data ?? []) as unknown as Profile[];

  // order count / lifetime spend – only for the users on this page
  const totals = new Map<string, { count: number; spent: number }>();
  if (profiles.length) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("user_id, total_micros, status")
      .in("user_id", profiles.map((p) => p.id));
    if (ordersError) throw new Error(`Failed to load users: ${ordersError.message}`);
    for (const o of (orders ?? []) as { user_id: string; total_micros: number; status: OrderStatus }[]) {
      const t = totals.get(o.user_id) ?? { count: 0, spent: 0 };
      t.count += 1;
      if (o.status !== "cancelled") t.spent += o.total_micros;
      totals.set(o.user_id, t);
    }
  }

  return {
    items: profiles.map((p) => ({ ...p, order_count: totals.get(p.id)?.count ?? 0, total_spent_micros: totals.get(p.id)?.spent ?? 0 })),
    total,
    page,
    perPage,
  };
}

export async function adminGetUser(id: string): Promise<ProfileWithOrders | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const [{ data, error }, ordersRes] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
    withOrderColumns((columns) =>
      supabase.from("orders").select(`${columns}, order_items(id, quantity)`).eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    ),
  ]);
  if (error) throw new Error(`Failed to load user: ${error.message}`);
  if (!data) return null;
  const orders = (ordersRes.data ?? []) as unknown as Order[];
  return {
    ...(data as Profile),
    orders,
    order_count: orders.length,
    total_spent_micros: orders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.total_micros, 0),
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

/**
 * Settings row for the dashboard. `migrated` is false when the database has not
 * run `20261018000000_settings_tabs.sql` yet (the newer columns are missing) so
 * the page can show a hint instead of failing on save; `homeMigrated` does the
 * same for the UI → Home page columns (`20261024000000_home_sections.sql`).
 */
export async function adminGetSiteSettings(): Promise<(SiteSettingsRow & { migrated: boolean; homeMigrated: boolean; currencyMigrated: boolean; media: SettingsMedia }) | null> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const settings = normaliseSiteSettings(row);

  // Library files behind the branding URLs (for the previews / names in the forms).
  const media: SettingsMedia = { favicon: null, share_image: null };
  const ids = [settings.favicon_media_id, settings.seo_og_image_media_id].filter((v): v is string => Boolean(v));
  if (ids.length) {
    const { data: refs } = await supabase.from("media").select(MEDIA_REF_COLUMNS).in("id", ids);
    for (const ref of (refs ?? []) as MediaRef[]) {
      if (ref.id === settings.favicon_media_id) media.favicon = ref;
      if (ref.id === settings.seo_og_image_media_id) media.share_image = ref;
    }
  }

  return {
    ...settings,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    migrated: "manage_stock" in row,
    homeMigrated: "home_show_filter" in row, // 20261024000000_home_sections.sql
    currencyMigrated: "usd_to_bdt_rate" in row, // 20261025000000_currency.sql
    media,
  };
}


/* ── Menus (UI → Menu) ───────────────────────────────────────────────────── */

export const MENU_ITEM_COLUMNS = "id, location, kind, title, page_id, category_id, url, open_in_new_tab, sort_order, parent_id, page:pages(id, title, slug, status), category:categories(id, name, slug)";
const MENU_ITEM_COLUMNS_LEGACY = "id, location, kind, title, page_id, category_id, url, open_in_new_tab, sort_order, page:pages(id, title, slug, status), category:categories(id, name, slug)";

/** `menu_items` is missing until migration 20261023000000_menus.sql has run. */
export function isMissingMenuSchema(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /menu_items/i.test(message) && /does not exist|schema cache|Could not find/i.test(message);
}

export async function adminListMenuItems(location: MenuLocation): Promise<MenuItem[]> {
  await requireAdmin();
  const supabase = await createClient();
  const primaryRes = await supabase
    .from("menu_items")
    .select(MENU_ITEM_COLUMNS)
    .eq("location", location)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  let data: unknown[] | null = primaryRes.data;
  let error = primaryRes.error;
  let usedLegacy = false;
  if (error && /parent_id/i.test(`${error.message} ${error.code}`)) {
    usedLegacy = true;
    const legacyRes = await supabase
      .from("menu_items")
      .select(MENU_ITEM_COLUMNS_LEGACY)
      .eq("location", location)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    data = legacyRes.data;
    error = legacyRes.error;
  }

  if (error) throw new Error(`Failed to load menu: ${error.message}`);
  const items = (data ?? []) as unknown as MenuItem[];

  if (location !== "header") {
    return items.map((item) => ({ ...item, parent_id: null }));
  }

  if (usedLegacy) {
    const { data: settingsRow } = await supabase
      .from("site_settings")
      .select("theme_gradients")
      .eq("id", 1)
      .maybeSingle();
    const meta =
      settingsRow?.theme_gradients && typeof settingsRow.theme_gradients === "object"
        ? (settingsRow.theme_gradients as Record<string, unknown>)
        : {};
    const parentMap =
      meta.menu_parent_map && typeof meta.menu_parent_map === "object"
        ? (meta.menu_parent_map as Record<string, string | null>)
        : {};
    return items.map((item) => ({
      ...item,
      parent_id: parentMap[item.id] ?? null,
    }));
  }

  return items.map((item) => ({ ...item, parent_id: item.parent_id ?? null }));
}

export type PageOption = { id: string; title: string; slug: string; status: PageStatus };

/** Every page (drafts included – they are listed but only shown in the storefront once published). */
export async function adminListPageOptions(): Promise<PageOption[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("pages").select("id, title, slug, status").order("title", { ascending: true }).limit(500);
  if (error) throw new Error(`Failed to load pages: ${error.message}`);
  return (data ?? []) as PageOption[];
}
