import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_REF_COLUMNS, isMissingMediaSchema, withSortedGallery } from "@/lib/media/shared";
import type { Category, Product } from "@/lib/types";

const PRODUCT_COLUMNS =
  "id, category_id, name, slug, description, price_cents, compare_at_price_cents, image_url, stock, is_active, is_featured, created_at, category:categories(id, name, slug)";

/** Product page: main image alt text + the ordered gallery from the media library. */
const PRODUCT_DETAIL_COLUMNS = `${PRODUCT_COLUMNS}, image_media_id, image_media:media!products_image_media_id_fkey(${MEDIA_REF_COLUMNS}), gallery:product_media(media_id, position, media(${MEDIA_REF_COLUMNS}))`;

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

  // When filtering by category we need an inner join so that products from
  // other categories are dropped instead of returned with `category: null`.
  const columns = options.categorySlug
    ? PRODUCT_COLUMNS.replace("category:categories(", "category:categories!inner(")
    : PRODUCT_COLUMNS;

  let query = supabase
    .from("products")
    .select(columns)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (options.categorySlug) query = query.eq("categories.slug", options.categorySlug);
  if (options.featuredOnly) query = query.eq("is_featured", true);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []) as unknown as Product[];
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const supabase = await createClient();
  const load = (columns: string) => supabase.from("products").select(columns).eq("slug", slug).eq("is_active", true).maybeSingle();
  let { data, error } = await load(PRODUCT_DETAIL_COLUMNS);
  // Before the media migration ran the embeds don't resolve – fall back to the plain row.
  if (error && isMissingMediaSchema(error.message)) ({ data, error } = await load(PRODUCT_COLUMNS));
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? withSortedGallery(data as unknown as Product) : null;
}
