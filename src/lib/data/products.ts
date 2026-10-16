import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingMediaSchema, withSortedGallery } from "@/lib/media/shared";
import { isMissingVariationSchema } from "@/lib/data/product-columns";
import { PRODUCT_COLUMNS, PRODUCT_DETAIL_COLUMNS, PRODUCT_DETAIL_COLUMNS_LEGACY, PRODUCT_COLUMNS_LEGACY } from "@/lib/data/product-columns";
import { withSortedVariations } from "@/lib/variations";
import { PRODUCTS_PER_PAGE } from "@/lib/catalog";
import { pageCount } from "@/lib/pagination";
import type { Category, Product } from "@/lib/types";

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  return (data ?? []) as Category[];
}

export async function getProducts(options: {
  categorySlug?: string;
  featuredOnly?: boolean;
  search?: string;
  limit?: number;
} = {}): Promise<Product[]> {
  const supabase = await createClient();

  const build = (columns: string) => {
    // When filtering by category we need an inner join so that products from
    // other categories are dropped instead of returned with `category: null`.
    const withJoin = options.categorySlug ? columns.replace("category:categories(", "category:categories!inner(") : columns;
    let query = supabase
      .from("products")
      .select(withJoin)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (options.categorySlug) query = query.eq("categories.slug", options.categorySlug);
    if (options.featuredOnly) query = query.eq("is_featured", true);
    if (options.search) query = query.ilike("name", `%${options.search}%`);
    if (options.limit) query = query.limit(options.limit);
    return query;
  };

  const { data, error } = await build(PRODUCT_COLUMNS);
  if (error) {
    // A database that has not run migration 14 yet simply has no `type` / `sku`.
    if (!isMissingVariationSchema(error)) throw new Error(`Failed to load products: ${error.message}`);
    const retry = await build(PRODUCT_COLUMNS_LEGACY);
    if (retry.error) throw new Error(`Failed to load products: ${retry.error.message}`);
    return (retry.data ?? []) as unknown as Product[];
  }
  return (data ?? []) as unknown as Product[];
}

export type ProductPage = { items: Product[]; total: number; page: number; pages: number; perPage: number };

/**
 * One page of the public catalogue (/shop). Counts first, clamps the requested page to what
 * exists, then fetches that window – the caller redirects when `page` differs from what it
 * asked for, so the URL always matches the products on screen (same contract as the admin
 * lists). `categoryId` rather than a slug: the shop already has the categories in hand.
 */
export async function getProductPage(options: { categoryId?: string; search?: string; page?: number; perPage?: number } = {}): Promise<ProductPage> {
  const supabase = await createClient();
  const perPage = Math.max(1, options.perPage ?? PRODUCTS_PER_PAGE);
  const build = (columns: string, head: boolean) => {
    let q = supabase.from("products").select(columns, { count: "exact", head }).eq("is_active", true);
    if (options.categoryId) q = q.eq("category_id", options.categoryId);
    if (options.search) q = q.ilike("name", `%${options.search}%`);
    return q;
  };

  const { count, error: countError } = await build("id", true);
  if (countError) throw new Error(`Failed to load products: ${countError.message}`);
  const total = count ?? 0;
  const pages = pageCount(total, perPage);
  const page = Math.min(Math.max(1, options.page ?? 1), pages);
  const from = (page - 1) * perPage;

  const run = (columns: string) =>
    build(columns, false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // stable order for rows created in the same instant (e.g. seed data)
      .range(from, from + perPage - 1);

  let { data, error } = await run(PRODUCT_COLUMNS);
  if (error && isMissingVariationSchema(error)) ({ data, error } = await run(PRODUCT_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return { items: (data ?? []) as unknown as Product[], total, page, pages, perPage };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const supabase = await createClient();
  const load = (columns: string) => supabase.from("products").select(columns).eq("slug", slug).eq("is_active", true).maybeSingle();
  // Full row first (media + attributes + variations); older databases fall back one step at a time.
  let { data, error } = await load(PRODUCT_DETAIL_COLUMNS);
  if (error && /product_variations|product_attributes/i.test(`${error.message} ${error.code}`)) {
    ({ data, error } = await load(PRODUCT_DETAIL_COLUMNS_LEGACY));
  }
  // Before the media migration ran the embeds don't resolve – fall back to the plain row.
  if (error && isMissingMediaSchema(error.message)) ({ data, error } = await load(PRODUCT_COLUMNS_LEGACY));
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? withSortedVariations(withSortedGallery(data as unknown as Product)) : null;
}
