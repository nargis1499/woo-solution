import type { ProductReview } from "@/lib/types";

/**
 * Review maths shared by the product page, the admin queue and the tests.
 * Pure functions over the rows the data layer already fetched.
 */

export type ReviewSort = "newest" | "highest" | "lowest" | "helpful";

export const REVIEW_SORTS: { id: ReviewSort; label: string }[] = [
  { id: "newest", label: "Most recent" },
  { id: "highest", label: "Highest rated" },
  { id: "lowest", label: "Lowest rated" },
  { id: "helpful", label: "Most helpful" },
];

export type RatingSummary = {
  count: number;
  /** 0 when there are no reviews. */
  average: number;
  /** Counts indexed by stars descending: [5★, 4★, 3★, 2★, 1★]. */
  distribution: [number, number, number, number, number];
  /** The same rows as 0–100 percentages (for the distribution bars). */
  percentages: [number, number, number, number, number];
  /** Share of reviewers who gave 4 or 5 stars. */
  recommendPercent: number;
  verifiedCount: number;
};

const EMPTY_BARS: [number, number, number, number, number] = [0, 0, 0, 0, 0];

export function summarizeReviews(reviews: Pick<ProductReview, "rating" | "is_verified_purchase">[]): RatingSummary {
  const count = reviews.length;
  if (count === 0) {
    return { count: 0, average: 0, distribution: [...EMPTY_BARS], percentages: [...EMPTY_BARS], recommendPercent: 0, verifiedCount: 0 };
  }
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let recommend = 0;
  let verifiedCount = 0;
  for (const review of reviews) {
    const rating = Math.min(5, Math.max(1, Math.round(review.rating)));
    distribution[5 - rating] += 1;
    total += rating;
    if (rating >= 4) recommend += 1;
    if (review.is_verified_purchase) verifiedCount += 1;
  }
  return {
    count,
    average: Math.round((total / count) * 100) / 100,
    distribution,
    percentages: distribution.map((n) => Math.round((n / count) * 100)) as RatingSummary["percentages"],
    recommendPercent: Math.round((recommend / count) * 100),
    verifiedCount,
  };
}

export function sortReviews<T extends Pick<ProductReview, "rating" | "helpful_count" | "created_at">>(reviews: T[], sort: ReviewSort): T[] {
  const byNewest = (a: T, b: T) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const out = [...reviews];
  switch (sort) {
    case "highest":
      return out.sort((a, b) => b.rating - a.rating || byNewest(a, b));
    case "lowest":
      return out.sort((a, b) => a.rating - b.rating || byNewest(a, b));
    case "helpful":
      return out.sort((a, b) => b.helpful_count - a.helpful_count || byNewest(a, b));
    case "newest":
    default:
      return out.sort(byNewest);
  }
}

/** "4.8" / "4" — no trailing ".0". */
export function formatRating(average: number): string {
  if (!Number.isFinite(average) || average <= 0) return "0";
  const rounded = Math.round(average * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type QueryError = { code?: string; message?: string } | null | undefined;

/** A database that has not run migration 20261061 yet (review features simply stay off). */
export function isMissingReviewsSchema(error: QueryError): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.code ?? ""}`;
  return (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    (/product_reviews|review_helpful_votes|product_rating_stats|submit_product_review|toggle_review_helpful/i.test(text) &&
      /does not exist|schema cache|Could not find/i.test(text))
  );
}
