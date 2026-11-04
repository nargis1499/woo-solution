"use server";

import { revalidatePath } from "next/cache";
import { isMissingReviewsSchema } from "@/lib/reviews";
import { createClient } from "@/lib/supabase/server";
import type { ProductReview } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export type SubmitReviewResult =
  | { ok: true; review: ProductReview }
  | { ok: false; error: string };

/**
 * Creates or updates the signed-in customer's review via
 * `submit_product_review()` — verified status, moderation state and the
 * author snapshot are all decided inside the database, never here.
 */
export async function submitReview(input: {
  productId: string;
  slug: string;
  rating: number;
  title: string;
  body: string;
}): Promise<SubmitReviewResult> {
  const productId = clean(input?.productId, 40);
  const slug = clean(input?.slug, 120);
  const rating = Math.round(Number(input?.rating));
  const title = clean(input?.title, 120);
  const body = clean(input?.body, 2000);

  if (!UUID_RE.test(productId)) return { ok: false, error: "Something went wrong. Please reload the page." };
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, error: "Please choose a star rating." };
  if (body.length < 3) return { ok: false, error: "Please write a little more about the product." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { ok: false, error: "Please sign in to write a review." };

  const { data, error } = await supabase.rpc("submit_product_review", {
    p_product_id: productId,
    p_rating: rating,
    p_title: title || null,
    p_body: body,
  });
  if (error) {
    if (isMissingReviewsSchema(error)) return { ok: false, error: "Reviews aren't available right now." };
    return { ok: false, error: error.message || "We couldn't save your review. Please try again." };
  }

  if (SLUG_RE.test(slug)) revalidatePath(`/products/${slug}`);
  return { ok: true, review: data as unknown as ProductReview };
}

export type ToggleHelpfulResult =
  | { ok: true; helpful: boolean; helpfulCount: number }
  | { ok: false; error: string };

export async function toggleReviewHelpful(input: { reviewId: string }): Promise<ToggleHelpfulResult> {
  const reviewId = clean(input?.reviewId, 40);
  if (!UUID_RE.test(reviewId)) return { ok: false, error: "Something went wrong. Please reload the page." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { ok: false, error: "Please sign in to mark a review helpful." };

  const { data, error } = await supabase.rpc("toggle_review_helpful", { p_review_id: reviewId });
  if (error) {
    if (isMissingReviewsSchema(error)) return { ok: false, error: "Reviews aren't available right now." };
    return { ok: false, error: error.message || "We couldn't record your vote." };
  }
  const result = (data ?? {}) as { helpful?: unknown; helpful_count?: unknown };
  return {
    ok: true,
    helpful: result.helpful === true,
    helpfulCount: Math.max(0, Math.round(Number(result.helpful_count ?? 0)) || 0),
  };
}
