"use server";

import { redirect } from "next/navigation";
import {
  UUID_RE,
  adminClient,
  failure,
  friendlyError,
  isRedirectError,
  notice,
  returnTo,
  revalidateStore,
  str,
  type AdminFormState,
} from "@/lib/admin/form";
import { isMissingReviewsSchema } from "@/lib/reviews";
import type { ReviewStatus } from "@/lib/types";

export type { AdminFormState } from "@/lib/admin/form";

const LIST_PATH = "/nemesis/reviews";
const MIGRATION_HINT = "The review tables are missing – run supabase/migrations/20261061000000_coupons_reviews.sql in the Supabase SQL Editor, then try again.";

function reviewError(e: unknown): string {
  if (isMissingReviewsSchema(e as { code?: string; message?: string })) return MIGRATION_HINT;
  return friendlyError(e);
}

/** Approve / reject / move back to pending from the moderation queue. */
export async function setReviewStatus(formData: FormData): Promise<void> {
  const back = returnTo(formData, LIST_PATH);
  const id = str(formData, "id", 40);
  const status = str(formData, "status", 10) as ReviewStatus;
  if (!UUID_RE.test(id) || !["pending", "approved", "rejected"].includes(status)) {
    redirect(failure(back, "Invalid review action."));
  }
  try {
    const { supabase } = await adminClient();
    const { error } = await supabase.from("product_reviews").update({ status }).eq("id", id);
    if (error) throw error;
    revalidateStore();
    redirect(
      notice(
        back,
        status === "approved" ? "Review approved and published." : status === "rejected" ? "Review rejected." : "Review moved back to pending.",
      ),
    );
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, reviewError(e)));
  }
}

/** Save (or clear, when empty) the store's public response under a review. */
export async function replyToReview(formData: FormData): Promise<void> {
  const back = returnTo(formData, LIST_PATH);
  const id = str(formData, "id", 40);
  const text = str(formData, "response_text", 1000);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid review id."));
  try {
    const { supabase } = await adminClient();
    const { error } = await supabase
      .from("product_reviews")
      .update({ response_text: text || null, response_at: text ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) throw error;
    revalidateStore();
    redirect(notice(back, text ? "Response published under the review." : "Response removed."));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, reviewError(e)));
  }
}

export async function deleteReview(formData: FormData): Promise<AdminFormState> {
  const back = str(formData, "return_to", 600) ? returnTo(formData, LIST_PATH) : null;
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) {
    if (back) redirect(failure(back, "Invalid review id."));
    return { error: "Invalid review id." };
  }
  try {
    const { supabase } = await adminClient();
    const { error } = await supabase.from("product_reviews").delete().eq("id", id);
    if (error) throw error;
    revalidateStore();
    const message = "Review deleted.";
    if (back) redirect(notice(back, message));
    return { success: message };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (back) redirect(failure(back, reviewError(e)));
    return { error: reviewError(e) };
  }
}
