import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheckIcon, CheckIcon, ClockIcon, RotateCcwIcon, StarIcon, ThumbsUpIcon, XIcon } from "lucide-react";
import { adminListReviews, adminReviewCounts } from "@/lib/admin/data";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate } from "@/lib/format";
import type { ReviewStatus } from "@/lib/types";
import { deleteReview, replyToReview, setReviewStatus } from "./actions";
import { Stars } from "@/components/reviews/stars";
import { DeleteButton } from "@/components/admin/form-bits";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { EmptyState, PageHeader, StatCard, Thumb, ToneBadge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "Reviews" };

const LIST_PATH = "/nemesis/reviews";

type SearchParams = Promise<{ page?: string; per?: string; status?: string; notice?: string; error?: string }>;

const FILTERS: { id: ReviewStatus | ""; label: string }[] = [
  { id: "", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export default async function AdminReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status: ReviewStatus | "" =
    sp.status === "pending" || sp.status === "approved" || sp.status === "rejected" ? sp.status : "";
  const { perPage, requestedPage } = await resolveListParams(sp);
  const [{ items, total, page }, counts] = await Promise.all([
    adminListReviews({ status, page: requestedPage, perPage }),
    adminReviewCounts(),
  ]);
  redirectIfClamped(LIST_PATH, { status: status || undefined }, sp, requestedPage, page, perPage);
  const listUrl = listHref(LIST_PATH, { status: status || undefined, per: perPage, page });
  const location = { pathname: LIST_PATH, params: { status: status || undefined }, page, perPage };

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Verified purchases publish automatically; everything else waits here. Replying to a review shows your response under it on the product page."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting moderation" value={counts.pending} hint="New pending reviews also arrive as a notification" icon={<ClockIcon />} />
        <StatCard label="Published" value={counts.approved} hint="Live on product pages & in Google stars" icon={<StarIcon />} />
        <StatCard label="Rejected" value={counts.rejected} hint="Kept for reference, never shown" icon={<XIcon />} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:max-w-md" role="tablist" aria-label="Filter reviews by status">
        {FILTERS.map((filter) => (
          <Link
            key={filter.id || "all"}
            href={listHref(LIST_PATH, { status: filter.id || undefined, per: perPage, page: 1 })}
            role="tab"
            aria-selected={status === filter.id}
            className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              status === filter.id ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {filter.label}
            {filter.id === "pending" && counts.pending > 0 ? ` (${counts.pending})` : ""}
          </Link>
        ))}
      </div>

      {total === 0 ? (
        <EmptyState title={status ? `No ${status} reviews` : "No reviews yet"} icon={<StarIcon />}>
          {status
            ? "Nothing is waiting in this part of the queue."
            : "Reviews customers write on product pages will appear here. If this store was set up before reviews arrived, run supabase/migrations/20261061000000_coupons_reviews.sql first."}
        </EmptyState>
      ) : (
        <>
          <ListToolbar {...location}>{null}</ListToolbar>
          <ul className="space-y-4">
            {items.map((review) => (
              <li key={review.id} className="overflow-hidden rounded-xl border bg-card shadow-xs">
                <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
                  {review.product ? (
                    <Link href={`/nemesis/products/${review.product.id}`} className="flex min-w-0 items-center gap-3">
                      <Thumb src={review.product.image_url} size="md" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium hover:underline">{review.product.name}</span>
                        <span className="block text-xs text-muted-foreground">View product</span>
                      </span>
                    </Link>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {review.is_verified_purchase ? (
                      <ToneBadge tone="emerald">
                        <BadgeCheckIcon className="mr-1 size-3" aria-hidden /> Verified purchase
                      </ToneBadge>
                    ) : (
                      <ToneBadge tone="neutral">Not verified</ToneBadge>
                    )}
                    <ToneBadge tone={review.status === "approved" ? "emerald" : review.status === "pending" ? "amber" : "red"}>
                      {review.status}
                    </ToneBadge>
                  </div>
                </div>

                <div className="border-t px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={review.rating} starClassName="size-4" />
                    <span className="text-sm font-semibold">{review.author_name}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(review.created_at)}</span>
                    {review.helpful_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsUpIcon className="size-3" aria-hidden /> {review.helpful_count} helpful
                      </span>
                    ) : null}
                  </div>
                  {review.title ? <p className="mt-2 font-semibold">{review.title}</p> : null}
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{review.body}</p>

                  <form action={replyToReview} className="mt-4 space-y-2">
                    <input type="hidden" name="id" value={review.id} />
                    <input type="hidden" name="return_to" value={listUrl} />
                    <Textarea
                      name="response_text"
                      rows={2}
                      maxLength={1000}
                      placeholder="Reply publicly as the store (optional)…"
                      defaultValue={review.response_text ?? ""}
                      aria-label="Store response"
                    />
                    <Button type="submit" variant="outline" size="sm">
                      {review.response_text ? "Update response" : "Publish response"}
                    </Button>
                  </form>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3 sm:px-5">
                  {review.status !== "approved" ? (
                    <form action={setReviewStatus}>
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="approved" />
                      <input type="hidden" name="return_to" value={listUrl} />
                      <Button type="submit" size="sm">
                        <CheckIcon /> Approve
                      </Button>
                    </form>
                  ) : null}
                  {review.status !== "rejected" ? (
                    <form action={setReviewStatus}>
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="rejected" />
                      <input type="hidden" name="return_to" value={listUrl} />
                      <Button type="submit" variant="outline" size="sm">
                        <XIcon /> Reject
                      </Button>
                    </form>
                  ) : null}
                  {review.status !== "pending" ? (
                    <form action={setReviewStatus}>
                      <input type="hidden" name="id" value={review.id} />
                      <input type="hidden" name="status" value="pending" />
                      <input type="hidden" name="return_to" value={listUrl} />
                      <Button type="submit" variant="ghost" size="sm">
                        <RotateCcwIcon /> Move to pending
                      </Button>
                    </form>
                  ) : null}
                  <span className="ml-auto">
                    <DeleteButton
                      action={deleteReview}
                      id={review.id}
                      returnTo={listUrl}
                      label="Delete review"
                      title="Delete this review?"
                      description="The review and its helpful votes are removed permanently. Rejecting keeps a record instead."
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Pagination {...location} total={total} />
        </>
      )}
    </>
  );
}
