# Coupons & product reviews

Migration: `supabase/migrations/20261061000000_coupons_reviews.sql` — run it in the
Supabase SQL Editor **together with the matching app release** (checkout calls the
new 3-argument `place_order`). Until it runs, the storefront simply hides reviews
and the coupon box reports coupons as unavailable; orders without a coupon keep
working through a 2-argument fallback in the checkout action.

## Coupons

Managed under **Nemesis → Coupons**.

| Rule | Behaviour |
| --- | --- |
| Types | Percentage off, fixed amount off — each optionally combined with **free shipping** (a free-shipping-only code is fine too) |
| Guard rails | Minimum spend, max-discount cap, start/expiry, total usage limit, per-customer limit, first-order-only |
| Scope | Whole order, selected categories, or selected products. With a scoped coupon the discount *and* the minimum spend only count matching lines |
| One per order | The cart/checkout accept a single code; applying a new one replaces the old |
| Server truth | `preview_coupon()` prices the cart for display; `place_order(items, shipping, coupon_code)` re-validates and recomputes everything while holding a row lock on the coupon, so limits can't be raced |
| Counting | Redemption is recorded at order placement (`coupon_redemptions`, one row per order) and **released again when the order is cancelled** (`orders_release_coupon_on_cancel`) |
| Orders | `orders.discount_micros` + `coupon_code`/`coupon_id` are stamped on the order and shown on both order pages; `total_micros` is already net of the discount |
| Secrecy | `coupons` is admin-RLS only. Customers can never list codes — they can only ask whether *one* code applies to their cart, and unknown/expired/exhausted codes all answer identically |
| Shipping | Shipping is priced on the discounted subtotal; a free-shipping coupon forces it to 0 |

Money notes: amounts are stored as USD micros like every other price
(`amount_off_micros`, `min_subtotal_micros`, `max_discount_micros`). The admin form
types them in the store's display currency and converts through the same
`money_*` hidden fields the product form uses. Percentages may be fractional
(`percent_off numeric(5,2)`, e.g. 12.5%); the discount floors to whole micros.

Quick-checkout (buy-now packs) places its order without a coupon — coupons live
on the cart/checkout path.

## Reviews

Shown on every product page in the **Ratings & reviews** tab, moderated
under **Nemesis → Reviews**.

| Rule | Behaviour |
| --- | --- |
| Who can post | Any signed-in customer, one review per product (re-submitting edits it) |
| Verified purchase | Computed in the database: a *completed* order by that customer containing the product. Verified reviews publish instantly and carry the badge; everyone else waits in the moderation queue |
| Moderation | Approve / reject / back-to-pending / delete, plus an optional public **store response**. New pending reviews notify every admin (`product_review` notification kind) |
| Helpful votes | One toggle per customer per review (`toggle_review_helpful()`); you can't vote on your own review. `helpful_count` is maintained by trigger |
| Display | Average + distribution bars (click a row to filter by that star), % who recommend (4–5★), sort by newest/highest/lowest/most helpful, "show more" paging |
| Stars everywhere | `product_rating_stats` (approved only) feeds product cards, the product header chip and the `aggregateRating` JSON-LD — the last of those is what earns the ★ row in Google results |
| Author snapshot | Name/avatar are copied onto the review at submission (like `order_messages`), so profile edits/deletions never break old reviews |

Submissions and votes only exist as `SECURITY DEFINER` RPCs — there is no
direct insert policy, so status/verified flags can't be forged from the browser.

## Demo data

`supabase/seed.sql` adds `WELCOME10` (10% off, first order), `FREESHIP`
(free shipping over $75), `SAVE20` ($20 off over $100, 100 uses) and eight
approved demo reviews across the seeded catalogue. Both inserts are guarded,
so re-running the seed is safe. Fresh client installs get them through
`complete-setup.sql` / the live setup export as usual.

## Verification

- `npm run test:ai` runs `tests/coupons-reviews.test.ts` alongside the other
  suites (discount maths, status derivation, rating summary/sorting).
- CI runs lint, TypeScript, the tests and the production build for every PR.
- Applied to the connected Supabase project as migration `coupons_reviews`;
  `preview_coupon()` was smoke-tested there (percent/fixed maths, minimum
  spend rejection) and `product_rating_stats` returns the seeded aggregates.
- `artifacts/reviews-product-page.png` and `artifacts/coupons-cart-admin.png`
  are faithful preview renders of the shipped UI with the seeded demo data —
  the build sandbox has no browser and no route to Supabase, so they are
  renders, not browser screenshots. The real thing is on the live site.
