import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingReviewsSchema, summarizeReviews, type RatingSummary } from "@/lib/reviews";
import { getSiteSettings } from "@/lib/site-settings";
import type { Product, ProductReview } from "@/lib/types";

const REVIEW_COLUMNS =
  "id, product_id, user_id, author_name, author_avatar_url, rating, title, body, status, is_verified_purchase, helpful_count, response_text, response_at, created_at, updated_at";

export type ProductReviewsData = {
  /** Approved reviews plus the signed-in customer's own (any status), newest first. */
  reviews: ProductReview[];
  /** Aggregates over approved reviews only. */
  summary: RatingSummary;
  /** False when reviews are switched off or migration 20261061 has not run yet. */
  available: boolean;
};

/** E-commerce → General feature switch; older cached settings without the field stay enabled. */
async function isReviewsEnabled(): Promise<boolean> {
  const settings = await getSiteSettings();
  return settings.reviews_enabled !== false;
}

/**
 * Reviews for one product page. RLS already scopes the rows (approved for
 * everyone, own rows for their author, everything for admins); this only
 * attaches the viewer's helpful votes and the aggregate summary.
 */
export async function getProductReviews(productId: string, userId?: string | null): Promise<ProductReviewsData> {
  const empty: ProductReviewsData = { reviews: [], summary: summarizeReviews([]), available: false };
  if (!(await isReviewsEnabled())) return empty;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_reviews")
    .select(REVIEW_COLUMNS)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingReviewsSchema(error)) return empty;
    throw new Error(`Failed to load reviews: ${error.message}`);
  }

  const reviews = (data ?? []) as unknown as ProductReview[];
  if (userId && reviews.length > 0) {
    const { data: votes } = await supabase
      .from("review_helpful_votes")
      .select("review_id")
      .eq("user_id", userId)
      .in(
        "review_id",
        reviews.map((r) => r.id),
      );
    const voted = new Set((votes ?? []).map((v) => String((v as { review_id: string }).review_id)));
    for (const review of reviews) review.helpful_by_me = voted.has(review.id);
  }

  return {
    reviews,
    summary: summarizeReviews(reviews.filter((r) => r.status === "approved")),
    available: true,
  };
}

type RatingStatRow = { product_id: string; review_count: number | string; avg_rating: number | string | null };

/**
 * Attaches `rating_avg` / `rating_count` (approved reviews) to product rows
 * for cards and headers. When Ratings & Reviews are switched off, any fields
 * already present are cleared so stars and aggregate SEO data disappear.
 * Best-effort: a pre-20261061 database simply leaves the fields off.
 */
export async function withRatings<T extends Product>(products: T[]): Promise<T[]> {
  if (!(await isReviewsEnabled())) {
    for (const product of products) {
      product.rating_avg = null;
      product.rating_count = 0;
    }
    return products;
  }
  const ids = [...new Set(products.map((p) => p.id).filter(Boolean))];
  if (ids.length === 0) return products;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_rating_stats")
    .select("product_id, review_count, avg_rating")
    .in("product_id", ids);
  if (error || !data) return products;
  const stats = new Map((data as RatingStatRow[]).map((row) => [row.product_id, row]));
  for (const product of products) {
    const row = stats.get(product.id);
    if (row) {
      product.rating_count = Number(row.review_count) || 0;
      product.rating_avg = row.avg_rating == null ? null : Number(row.avg_rating);
    }
  }
  return products;
}
