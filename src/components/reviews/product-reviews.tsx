"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  BadgeCheckIcon,
  ChevronDownIcon,
  ClockIcon,
  MessageSquareHeartIcon,
  PenLineIcon,
  ShieldCheckIcon,
  StarIcon,
  StoreIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { toast } from "sonner";
import { submitReview, toggleReviewHelpful } from "@/app/(store)/products/[slug]/review-actions";
import { formatDate } from "@/lib/format";
import { REVIEW_SORTS, formatRating, sortReviews, summarizeReviews, type ReviewSort } from "@/lib/reviews";
import type { CurrentUser, ProductReview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Stars } from "./stars";

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const PAGE_SIZE = 5;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "C";
}

/**
 * The product-page "Ratings & reviews" section (migration 20261061):
 * summary with distribution bars that double as star filters, sorting,
 * helpful votes, store responses and the write-a-review form. Server data
 * arrives as props; submissions upsert into local state so the customer
 * sees their review (and its moderation state) immediately.
 */
export function ProductReviews({
  productId,
  slug,
  storeName,
  initialReviews,
  currentUser,
}: {
  productId: string;
  slug: string;
  storeName: string;
  initialReviews: ProductReview[];
  currentUser: CurrentUser | null;
}) {
  const [reviews, setReviews] = useState<ProductReview[]>(initialReviews);
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);

  const approved = useMemo(() => reviews.filter((r) => r.status === "approved"), [reviews]);
  const summary = useMemo(() => summarizeReviews(approved), [approved]);
  const myReview = useMemo(
    () => (currentUser ? reviews.find((r) => r.user_id === currentUser.id) ?? null : null),
    [reviews, currentUser],
  );
  const myPending = myReview && myReview.status !== "approved" ? myReview : null;

  const listed = useMemo(() => {
    const filtered = starFilter ? approved.filter((r) => r.rating === starFilter) : approved;
    return sortReviews(filtered, sort);
  }, [approved, sort, starFilter]);
  const shown = listed.slice(0, visible);

  return (
    <section id="reviews" className="mt-10 scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-8" aria-labelledby="reviews-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.18em] text-indigo-300 uppercase">
            <MessageSquareHeartIcon className="size-3.5" aria-hidden /> Customer feedback
          </p>
          <h2 id="reviews-heading" className="text-2xl font-bold tracking-tight text-white">
            Ratings &amp; reviews
          </h2>
        </div>
        {currentUser ? (
          <Button
            variant="outline"
            className="border-slate-600 bg-slate-800/80 text-slate-100 hover:border-indigo-400/60 hover:bg-slate-800"
            onPress={() => setFormOpen((open) => !open)}
          >
            <PenLineIcon /> {myReview ? "Edit your review" : "Write a review"}
          </Button>
        ) : (
          <LinkButton
            href={`/login?next=${encodeURIComponent(`/products/${slug}#reviews`)}`}
            variant="outline"
            className="border-slate-600 bg-slate-800/80 text-slate-100 hover:border-indigo-400/60 hover:bg-slate-800"
          >
            <PenLineIcon /> Sign in to review
          </LinkButton>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[300px_1fr] lg:gap-10">
        {/* ── Summary ─────────────────────────────────────────────────── */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-center">
            <p className="text-5xl font-extrabold tracking-tight text-white tabular-nums">
              {summary.count ? formatRating(summary.average) : "–"}
            </p>
            <Stars value={summary.average} className="mt-2 justify-center" starClassName="size-5" />
            <p className="mt-2 text-sm text-slate-400">
              {summary.count ? `${summary.count} verified rating${summary.count === 1 ? "" : "s"} & review${summary.count === 1 ? "" : "s"}` : "No reviews yet"}
            </p>
            {summary.count > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                {summary.recommendPercent}% of reviewers recommend this product
                {summary.verifiedCount > 0 ? ` · ${summary.verifiedCount} from confirmed orders` : ""}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5" aria-label="Rating breakdown">
            {summary.distribution.map((count, index) => {
              const stars = 5 - index;
              const pct = summary.percentages[index];
              const active = starFilter === stars;
              return (
                <button
                  key={stars}
                  type="button"
                  disabled={count === 0}
                  onClick={() => {
                    setStarFilter(active ? null : stars);
                    setVisible(PAGE_SIZE);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                    active ? "bg-indigo-500/20 text-white" : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200",
                    count === 0 && "cursor-not-allowed opacity-40 hover:bg-transparent",
                  )}
                  aria-pressed={active}
                >
                  <span className="inline-flex w-7 items-center gap-0.5 font-semibold tabular-nums">
                    {stars} <StarIcon className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <span className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-10 text-right tabular-nums">{count}</span>
                </button>
              );
            })}
            {starFilter ? (
              <button type="button" onClick={() => setStarFilter(null)} className="px-2 pt-1 text-xs font-medium text-indigo-300 hover:text-indigo-200">
                Show all ratings
              </button>
            ) : null}
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs leading-relaxed text-slate-400">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
            Reviews marked “Verified purchase” come from a completed order at {storeName}. Unverified reviews are checked by our team before they appear.
          </p>
        </div>

        {/* ── List + form ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          {currentUser && formOpen ? (
            <ReviewForm
              key={myReview?.id ?? "new"}
              productId={productId}
              slug={slug}
              existing={myReview}
              onSaved={(review) => {
                setReviews((current) => [review, ...current.filter((r) => r.id !== review.id)]);
                setFormOpen(false);
              }}
              onCancel={() => setFormOpen(false)}
            />
          ) : null}

          {myPending && !formOpen ? (
            <div className="mb-5 rounded-xl border border-dashed border-amber-500/50 bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <ClockIcon className="size-4" aria-hidden />
                {myPending.status === "pending" ? "Your review is awaiting moderation" : "Your last review wasn't approved"}
              </p>
              <div className="mt-2">
                <ReviewCard review={myPending} storeName={storeName} currentUser={currentUser} onReviewsChange={setReviews} muted />
              </div>
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">
              {starFilter ? `${listed.length} review${listed.length === 1 ? "" : "s"} with ${starFilter} star${starFilter === 1 ? "" : "s"}` : `${listed.length} review${listed.length === 1 ? "" : "s"}`}
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-slate-400">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as ReviewSort)}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-100 outline-none focus:border-indigo-400"
                aria-label="Sort reviews"
              >
                {REVIEW_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
              <StarIcon className="mx-auto size-8 text-slate-600" aria-hidden />
              <p className="mt-3 font-semibold text-slate-200">{summary.count === 0 ? "Be the first to review this product" : "No reviews match this filter"}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
                {summary.count === 0
                  ? "Bought it already? Share what you liked (or didn't) and help the next shopper decide."
                  : "Try a different star rating from the breakdown on the left."}
              </p>
              {summary.count === 0 && currentUser ? (
                <Button className="mt-4" onPress={() => setFormOpen(true)}>
                  <PenLineIcon /> Write the first review
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {shown.map((review) => (
                  <ReviewCard key={review.id} review={review} storeName={storeName} currentUser={currentUser} onReviewsChange={setReviews} />
                ))}
              </ul>
              {listed.length > visible ? (
                <div className="mt-5 text-center">
                  <Button
                    variant="outline"
                    className="border-slate-600 bg-slate-800/80 text-slate-100 hover:border-indigo-400/60 hover:bg-slate-800"
                    onPress={() => setVisible((n) => n + PAGE_SIZE)}
                  >
                    <ChevronDownIcon /> Show more reviews ({listed.length - visible} remaining)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ReviewCard({
  review,
  storeName,
  currentUser,
  onReviewsChange,
  muted = false,
}: {
  review: ProductReview;
  storeName: string;
  currentUser: CurrentUser | null;
  onReviewsChange: React.Dispatch<React.SetStateAction<ProductReview[]>>;
  muted?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const isMine = Boolean(currentUser && review.user_id === currentUser.id);

  function vote() {
    if (!currentUser) {
      toast.error("Please sign in to mark a review helpful.");
      return;
    }
    startTransition(async () => {
      const result = await toggleReviewHelpful({ reviewId: review.id });
      if (result.ok) {
        onReviewsChange((current) =>
          current.map((r) => (r.id === review.id ? { ...r, helpful_by_me: result.helpful, helpful_count: result.helpfulCount } : r)),
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <li className={cn("rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5", muted && "border-0 bg-transparent p-0 sm:p-0")}>
      <article>
        <header className="flex flex-wrap items-center gap-3">
          {review.author_avatar_url ? (
            // Author avatars come from auth providers (any host) – a plain img keeps this host-agnostic.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.author_avatar_url} alt="" className="size-10 rounded-full object-cover" loading="lazy" />
          ) : (
            <span className="grid size-10 place-items-center rounded-full bg-indigo-500/25 text-sm font-bold text-indigo-200" aria-hidden>
              {initials(review.author_name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
              {review.author_name}
              {review.is_verified_purchase ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                  <BadgeCheckIcon className="size-3" aria-hidden /> Verified purchase
                </span>
              ) : null}
              {isMine ? <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[11px] font-semibold text-slate-200">Your review</span> : null}
            </p>
            <p className="text-xs text-slate-500">{formatDate(review.created_at)}</p>
          </div>
          <Stars value={review.rating} className="ml-auto shrink-0 self-start pt-0.5" starClassName="size-3.5" />
        </header>

        {review.title ? <h3 className="mt-3 font-semibold text-slate-100">{review.title}</h3> : null}
        <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-slate-300">{review.body}</p>

        {review.response_text ? (
          <div className="mt-3 rounded-r-lg border-l-2 border-indigo-400 bg-indigo-500/10 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-indigo-200 uppercase">
              <StoreIcon className="size-3.5" aria-hidden /> Response from {storeName}
              {review.response_at ? <span className="font-medium tracking-normal text-slate-400 normal-case">· {formatDate(review.response_at)}</span> : null}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-200">{review.response_text}</p>
          </div>
        ) : null}

        {!muted ? (
          <footer className="mt-3">
            <button
              type="button"
              onClick={vote}
              disabled={pending || isMine}
              aria-pressed={Boolean(review.helpful_by_me)}
              title={isMine ? "You can't vote on your own review" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                review.helpful_by_me
                  ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-100"
                  : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white",
                (pending || isMine) && "cursor-not-allowed opacity-50",
              )}
            >
              <ThumbsUpIcon className={cn("size-3.5", review.helpful_by_me && "fill-current")} aria-hidden />
              Helpful{review.helpful_count > 0 ? ` (${review.helpful_count})` : ""}
            </button>
          </footer>
        ) : null}
      </article>
    </li>
  );
}

function ReviewForm({
  productId,
  slug,
  existing,
  onSaved,
  onCancel,
}: {
  productId: string;
  slug: string;
  existing: ProductReview | null;
  onSaved: (review: ProductReview) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hovered, setHovered] = useState(0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = hovered || rating;

  function submit() {
    setError(null);
    if (rating === 0) {
      setError("Please choose a star rating.");
      return;
    }
    if (body.trim().length < 3) {
      setError("Please write a little more about the product.");
      return;
    }
    startTransition(async () => {
      const result = await submitReview({ productId, slug, rating, title, body });
      if (result.ok) {
        toast.success(
          result.review.status === "approved"
            ? "Thanks — your review is live."
            : "Thanks — your review will appear after a quick check by our team.",
        );
        onSaved(result.review);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      className="mb-6 rounded-xl border border-indigo-500/30 bg-slate-950/60 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="font-semibold text-white">{existing ? "Edit your review" : "Share your experience"}</h3>
      <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? "" : "s"} – ${RATING_LABELS[value]}`}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(0)}
            onFocus={() => setHovered(value)}
            onBlur={() => setHovered(0)}
            onClick={() => setRating(value)}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            <StarIcon className={cn("size-7 transition-colors", value <= shown ? "fill-amber-400 text-amber-400" : "text-slate-600")} aria-hidden />
          </button>
        ))}
        <span className="ml-2 text-sm font-medium text-slate-300" aria-live="polite">
          {shown ? RATING_LABELS[shown] : "Tap to rate"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Headline (optional) — e.g. Exceeded my expectations"
          maxLength={120}
          aria-label="Review headline"
          className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500"
        />
        <div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you like or dislike? How is the quality, delivery and value for money?"
            rows={4}
            maxLength={2000}
            aria-label="Your review"
            className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500"
          />
          <p className="mt-1 text-right text-xs text-slate-500 tabular-nums">{body.length} / 2000</p>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" isDisabled={pending}>
          {pending ? "Saving…" : existing ? "Save changes" : "Post review"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-slate-300 hover:bg-slate-800 hover:text-white"
          isDisabled={pending}
          onPress={onCancel}
        >
          Cancel
        </Button>
        <Link href="#reviews" className="sr-only">
          Reviews
        </Link>
        <p className="ml-auto text-xs text-slate-500">Verified purchases publish instantly.</p>
      </div>
    </form>
  );
}
