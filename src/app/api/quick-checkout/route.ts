import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteSettings } from "@/lib/site-settings";
import { isMissingMediaSchema, withSortedGallery } from "@/lib/media/shared";
import {
  isMissingBrandColumn,
  PRODUCT_COLUMNS_LEGACY,
  PRODUCT_DETAIL_COLUMNS,
  PRODUCT_DETAIL_COLUMNS_LEGACY,
  PRODUCT_DETAIL_COLUMNS_NO_BRAND,
} from "@/lib/data/product-columns";
import { withSortedVariations } from "@/lib/variations";
import type { Product } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId") ?? "";
  const categoryIdParam = searchParams.get("categoryId") ?? "";

  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { authenticated: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const settings = await getSiteSettings();

    // Resolve category_id if not provided
    let categoryId = UUID_RE.test(categoryIdParam) ? categoryIdParam : null;
    if (!categoryId) {
      const { data: baseProd } = await supabase
        .from("products")
        .select("category_id")
        .eq("id", productId)
        .maybeSingle();
      categoryId = (baseProd?.category_id as string | null) ?? null;
    }

    const loadCategoryProducts = (columns: string) => {
      let query = supabase
        .from("products")
        .select(columns)
        .eq("is_active", true)
        .order("is_featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(6);

      if (categoryId) {
        query = query.eq("category_id", categoryId);
      }
      return query;
    };

    const loadClickedProduct = (columns: string) =>
      supabase.from("products").select(columns).eq("id", productId).maybeSingle();

    let [listRes, clickedRes] = await Promise.all([
      loadCategoryProducts(PRODUCT_DETAIL_COLUMNS),
      loadClickedProduct(PRODUCT_DETAIL_COLUMNS),
    ]);

    if (listRes.error && isMissingBrandColumn(listRes.error)) {
      [listRes, clickedRes] = await Promise.all([
        loadCategoryProducts(PRODUCT_DETAIL_COLUMNS_NO_BRAND),
        loadClickedProduct(PRODUCT_DETAIL_COLUMNS_NO_BRAND),
      ]);
    }
    if (
      listRes.error &&
      /product_variations|product_attributes/i.test(
        `${listRes.error.message} ${listRes.error.code}`,
      )
    ) {
      [listRes, clickedRes] = await Promise.all([
        loadCategoryProducts(PRODUCT_DETAIL_COLUMNS_LEGACY),
        loadClickedProduct(PRODUCT_DETAIL_COLUMNS_LEGACY),
      ]);
    }
    if (listRes.error && isMissingMediaSchema(listRes.error.message)) {
      [listRes, clickedRes] = await Promise.all([
        loadCategoryProducts(PRODUCT_COLUMNS_LEGACY),
        loadClickedProduct(PRODUCT_COLUMNS_LEGACY),
      ]);
    }

    const rawList = ((listRes.data ?? []) as unknown as Product[]).map((p) =>
      withSortedVariations(withSortedGallery(p)),
    );
    const clicked = clickedRes.data
      ? withSortedVariations(withSortedGallery(clickedRes.data as unknown as Product))
      : null;

    // Ensure the clicked product is present in the 6-item category list
    const products: Product[] = [];
    if (clicked) {
      products.push(clicked);
    }
    for (const item of rawList) {
      if (item.id !== clicked?.id && products.length < 6) {
        products.push(item);
      }
    }

    return NextResponse.json({
      authenticated: true,
      storeName: settings.store_name,
      products,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load quick checkout data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
