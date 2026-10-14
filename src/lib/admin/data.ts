import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/auth";
import { ORDER_STATUSES } from "@/lib/admin/constants";
import type { AdminStats, Category, Order, OrderStatus, Product, Profile } from "@/lib/types";

/*
 * Admin read models. Every helper calls `requireAdmin()` first (cheap – the
 * lookup is memoised per request) and, independently, Row Level Security only
 * returns the full data set to admins. Belt and braces.
 */

const PRODUCT_COLUMNS =
  "id, category_id, name, slug, description, price_cents, compare_at_price_cents, image_url, stock, is_active, is_featured, created_at, updated_at, category:categories(id, name, slug)";

const ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, subtotal_cents, shipping_cents, total_cents, customer_email, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, notes, created_at";

const PROFILE_COLUMNS = "id, full_name, phone, email, avatar_url, is_admin, created_at, updated_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
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

export type ProductListOptions = { q?: string; category?: string; page?: number; perPage?: number };
export type ProductListPage = { items: Product[]; total: number };

/** One page of the admin product list plus the total for the same filter (drives the pager). */
export async function adminListProducts(options: ProductListOptions = {}): Promise<ProductListPage> {
  await requireAdmin();
  const supabase = await createClient();
  const perPage = Math.max(1, options.perPage ?? 10);
  const from = (Math.max(1, options.page ?? 1) - 1) * perPage;

  const term = options.q ? `%${escapeLike(options.q)}%` : null;
  const search = term ? `name.ilike.${term},slug.ilike.${term}` : null;
  const categoryId = options.category && isUuid(options.category) ? options.category : null;

  let query = supabase.from("products").select(PRODUCT_COLUMNS, { count: "exact" });
  if (search) query = query.or(search);
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // stable order for rows created in the same instant (e.g. seed data)
    .range(from, from + perPage - 1);

  if (error) {
    // PGRST103 = offset past the last row (page no longer exists after deletes / a size change).
    // Return the total so the page can redirect to the last valid page.
    if (error.code === "PGRST103") {
      let countQuery = supabase.from("products").select("id", { count: "exact", head: true });
      if (search) countQuery = countQuery.or(search);
      if (categoryId) countQuery = countQuery.eq("category_id", categoryId);
      const { count: total, error: countError } = await countQuery;
      if (countError) throw new Error(`Failed to load products: ${countError.message}`);
      return { items: [], total: total ?? 0 };
    }
    throw new Error(`Failed to load products: ${error.message}`);
  }
  const items = (data ?? []) as unknown as Product[];
  return { items, total: count ?? from + items.length };
}

export async function adminGetProduct(id: string): Promise<Product | null> {
  await requireAdmin();
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return (data as unknown as Product) ?? null;
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

export async function adminListOrders(options: { status?: string; q?: string } = {}): Promise<Order[]> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(`${ORDER_COLUMNS}, order_items(id, quantity)`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (options.status && ORDER_STATUSES.includes(options.status as OrderStatus)) {
    query = query.eq("status", options.status);
  }
  if (options.q) {
    const term = `%${escapeLike(options.q)}%`;
    const asNumber = Number(options.q.replace(/^#/, ""));
    const parts = [`shipping_name.ilike.${term}`, `customer_email.ilike.${term}`];
    if (Number.isInteger(asNumber) && asNumber > 0) parts.push(`order_number.eq.${asNumber}`);
    query = query.or(parts.join(","));
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return (data ?? []) as unknown as Order[];
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

export async function adminListUsers(options: { q?: string } = {}): Promise<ProfileWithOrders[]> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase.from("profiles").select(PROFILE_COLUMNS).order("created_at", { ascending: false }).limit(500);
  if (options.q) {
    const term = `%${escapeLike(options.q)}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }
  const [{ data, error }, orders] = await Promise.all([
    query,
    supabase.from("orders").select("user_id, total_cents, status").not("user_id", "is", null),
  ]);
  if (error) throw new Error(`Failed to load users: ${error.message}`);

  const totals = new Map<string, { count: number; spent: number }>();
  for (const o of (orders.data ?? []) as { user_id: string; total_cents: number; status: OrderStatus }[]) {
    const t = totals.get(o.user_id) ?? { count: 0, spent: 0 };
    t.count += 1;
    if (o.status !== "cancelled") t.spent += o.total_cents;
    totals.set(o.user_id, t);
  }

  return ((data ?? []) as Profile[]).map((p) => ({
    ...p,
    order_count: totals.get(p.id)?.count ?? 0,
    total_spent_cents: totals.get(p.id)?.spent ?? 0,
  }));
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

export async function adminGetSiteSettings() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_settings")
    .select("store_name, tagline, support_email, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  return data;
}
