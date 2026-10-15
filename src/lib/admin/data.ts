import "server-only";
import { MEDIA_REF_COLUMNS, isMissingMediaSchema, withSortedGallery } from "@/lib/media/shared";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/auth";
import { ORDER_STATUSES } from "@/lib/admin/constants";
import { pageCount } from "@/lib/admin/pagination";
import { normaliseSiteSettings } from "@/lib/site-settings";
import type { AdminStats, Category, Order, OrderStatus, Product, Profile, SiteSettingsRow } from "@/lib/types";

/*
 * Admin read models. Every helper calls `requireAdmin()` first (cheap – the
 * lookup is memoised per request) and, independently, Row Level Security only
 * returns the full data set to admins. Belt and braces.
 */

const PRODUCT_COLUMNS =
  "id, category_id, name, slug, description, price_cents, compare_at_price_cents, image_url, stock, is_active, is_featured, created_at, updated_at, category:categories(id, name, slug)";

/** Media-library embeds (main image + ordered gallery). Only used where the form needs them. */
const PRODUCT_MEDIA_COLUMNS = `${PRODUCT_COLUMNS}, image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;

const ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, subtotal_cents, shipping_cents, total_cents, customer_email, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, notes, created_at";

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
  const { data, error } = await supabase
    .from("orders")
    .select(`${ORDER_COLUMNS}, order_items(id, quantity)`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return (data ?? []) as unknown as Order[];
}

export async function adminGetLowStockProducts(limit = 6): Promise<Product[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .lte("stock", 5)
    .order("stock", { ascending: true })
    .limit(limit);
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

  const { data, error } = await build(PRODUCT_COLUMNS, false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // stable order for rows created in the same instant (e.g. seed data)
    .range(from, to);
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return { items: (data ?? []) as unknown as Product[], total, page, perPage };
}

export async function adminGetProduct(id: string): Promise<Product | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  let { data, error } = await supabase.from("products").select(PRODUCT_MEDIA_COLUMNS).eq("id", id).maybeSingle();
  // Before the media migration ran the embeds don't resolve – fall back to the plain row.
  if (error && isMissingMediaSchema(error.message)) ({ data, error } = await supabase.from("products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle());
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? withSortedGallery(data as unknown as Product) : null;
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function adminListCategories(): Promise<Category[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, sort_order, show_in_menu, products(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  type Row = Category & { products?: { count: number }[] };
  return ((data ?? []) as unknown as Row[]).map(({ products, ...c }) => ({
    ...c,
    product_count: products?.[0]?.count ?? 0,
  }));
}

export async function adminGetCategory(id: string): Promise<Category | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, sort_order, show_in_menu, products(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load category: ${error.message}`);
  if (!data) return null;
  const { products, ...c } = data as unknown as Category & { products?: { count: number }[] };
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

  const { data, error } = await build(`${ORDER_COLUMNS}, order_items(id, quantity)`, false)
    .order("created_at", { ascending: false })
    .order("order_number", { ascending: false })
    .range(from, to);
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return { items: (data ?? []) as unknown as Order[], total, page, perPage };
}

export async function adminGetOrder(id: string): Promise<Order | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `${ORDER_COLUMNS}, order_items(id, order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity, line_total_cents)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  return (data as unknown as Order) ?? null;
}


// ─── Users ──────────────────────────────────────────────────────────────────

export type ProfileWithOrders = Profile & { order_count: number; total_spent_cents: number; orders?: Order[] };

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
      .select("user_id, total_cents, status")
      .in("user_id", profiles.map((p) => p.id));
    if (ordersError) throw new Error(`Failed to load users: ${ordersError.message}`);
    for (const o of (orders ?? []) as { user_id: string; total_cents: number; status: OrderStatus }[]) {
      const t = totals.get(o.user_id) ?? { count: 0, spent: 0 };
      t.count += 1;
      if (o.status !== "cancelled") t.spent += o.total_cents;
      totals.set(o.user_id, t);
    }
  }

  return {
    items: profiles.map((p) => ({ ...p, order_count: totals.get(p.id)?.count ?? 0, total_spent_cents: totals.get(p.id)?.spent ?? 0 })),
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
    supabase
      .from("orders")
      .select(`${ORDER_COLUMNS}, order_items(id, quantity)`)
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (error) throw new Error(`Failed to load user: ${error.message}`);
  if (!data) return null;
  const orders = (ordersRes.data ?? []) as unknown as Order[];
  return {
    ...(data as Profile),
    orders,
    order_count: orders.length,
    total_spent_cents: orders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.total_cents, 0),
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

/**
 * Settings row for the dashboard. `migrated` is false when the database has not
 * run `20261018000000_settings_tabs.sql` yet (the newer columns are missing) so
 * the page can show a hint instead of failing on save.
 */
export async function adminGetSiteSettings(): Promise<(SiteSettingsRow & { migrated: boolean }) | null> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...normaliseSiteSettings(row),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    migrated: "manage_stock" in row,
  };
}
