import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stars } from "@/components/reviews/stars";
import {
  computeDiscountMicros,
  couponStatus,
  couponUsagePercent,
  describeCoupon,
  generateCouponCode,
  normalizeCouponCode,
  COUPON_CODE_RE,
} from "@/lib/coupons";
import { formatRating, sortReviews, summarizeReviews } from "@/lib/reviews";
import { USD_MONEY } from "@/lib/money";
import type { Coupon, ProductReview } from "@/lib/types";

const USD = 1_000_000;

const coupon = (patch: Partial<Coupon> = {}): Coupon => ({
  id: "00000000-0000-0000-0000-000000000001",
  code: "TEST",
  description: null,
  discount_type: "percent",
  percent_off: 10,
  amount_off_micros: null,
  max_discount_micros: null,
  min_subtotal_micros: 0,
  free_shipping: false,
  scope_type: "all",
  scope_ids: [],
  first_order_only: false,
  starts_at: null,
  expires_at: null,
  usage_limit: null,
  per_user_limit: 1,
  times_redeemed: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("coupon codes", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeCouponCode("  welcome 10 ")).toBe("WELCOME10");
    expect(normalizeCouponCode("save-now")).toBe("SAVE-NOW");
  });

  it("generates codes that pass validation and avoid confusing glyphs", () => {
    for (let i = 0; i < 25; i++) {
      const code = generateCouponCode("VIP");
      expect(code).toMatch(COUPON_CODE_RE);
      expect(code.slice(4)).not.toMatch(/[01IOL]/); // the random suffix avoids confusing glyphs (the prefix is the admin's choice)
      expect(code.startsWith("VIP-")).toBe(true);
    }
  });
});

describe("computeDiscountMicros (mirrors coupon_discount_for())", () => {
  it("percent floors to whole micros", () => {
    expect(computeDiscountMicros({ discount_type: "percent", percent_off: 10 }, 99_999_999)).toBe(9_999_999);
    expect(computeDiscountMicros({ discount_type: "percent", percent_off: 12.5 }, 80 * USD)).toBe(10 * USD);
    expect(computeDiscountMicros({ discount_type: "percent", percent_off: "20.00" }, 50 * USD)).toBe(10 * USD);
  });

  it("fixed is capped at the eligible subtotal", () => {
    expect(computeDiscountMicros({ discount_type: "fixed", amount_off_micros: 20 * USD }, 15 * USD)).toBe(15 * USD);
    expect(computeDiscountMicros({ discount_type: "fixed", amount_off_micros: 20 * USD }, 60 * USD)).toBe(20 * USD);
  });

  it("honours the max-discount cap and never goes negative", () => {
    expect(
      computeDiscountMicros({ discount_type: "percent", percent_off: 50, max_discount_micros: 25 * USD }, 100 * USD),
    ).toBe(25 * USD);
    expect(computeDiscountMicros({ discount_type: "percent", percent_off: 10 }, 0)).toBe(0);
    expect(computeDiscountMicros({ discount_type: "percent", percent_off: null }, 100 * USD)).toBe(0);
  });
});

describe("couponStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  it("derives disabled > scheduled > expired > exhausted > active", () => {
    expect(couponStatus(coupon({ is_active: false, expires_at: "2026-01-01T00:00:00Z" }), now)).toBe("disabled");
    expect(couponStatus(coupon({ starts_at: "2026-07-01T00:00:00Z" }), now)).toBe("scheduled");
    expect(couponStatus(coupon({ expires_at: "2026-06-01T00:00:00Z" }), now)).toBe("expired");
    expect(couponStatus(coupon({ usage_limit: 5, times_redeemed: 5 }), now)).toBe("exhausted");
    expect(couponStatus(coupon({ usage_limit: 5, times_redeemed: 4 }), now)).toBe("active");
    expect(couponStatus(coupon(), now)).toBe("active");
  });

  it("usage percent only moves with a limit", () => {
    expect(couponUsagePercent(coupon({ usage_limit: null, times_redeemed: 99 }))).toBe(0);
    expect(couponUsagePercent(coupon({ usage_limit: 4, times_redeemed: 3 }))).toBe(75);
    expect(couponUsagePercent(coupon({ usage_limit: 2, times_redeemed: 9 }))).toBe(100);
  });

  it("describes discounts for the admin list", () => {
    expect(describeCoupon(coupon(), USD_MONEY)).toBe("10% off");
    expect(describeCoupon(coupon({ discount_type: "fixed", percent_off: null, amount_off_micros: 15 * USD }), USD_MONEY)).toBe("$15.00 off");
    expect(describeCoupon(coupon({ percent_off: null, free_shipping: true }), USD_MONEY)).toBe("Free shipping");
    expect(describeCoupon(coupon({ free_shipping: true }), USD_MONEY)).toBe("10% off + free shipping");
  });
});

const review = (patch: Partial<ProductReview> = {}): ProductReview => ({
  id: Math.random().toString(36).slice(2),
  product_id: "p1",
  user_id: "u1",
  author_name: "Test",
  author_avatar_url: null,
  rating: 5,
  title: null,
  body: "Great",
  status: "approved",
  is_verified_purchase: false,
  helpful_count: 0,
  response_text: null,
  response_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("summarizeReviews", () => {
  it("handles the empty state", () => {
    const s = summarizeReviews([]);
    expect(s).toMatchObject({ count: 0, average: 0, recommendPercent: 0, verifiedCount: 0 });
    expect(s.distribution).toEqual([0, 0, 0, 0, 0]);
  });

  it("computes average, distribution, percentages and recommendations", () => {
    const s = summarizeReviews([
      review({ rating: 5, is_verified_purchase: true }),
      review({ rating: 5 }),
      review({ rating: 4, is_verified_purchase: true }),
      review({ rating: 2 }),
    ]);
    expect(s.count).toBe(4);
    expect(s.average).toBe(4);
    expect(s.distribution).toEqual([2, 1, 0, 1, 0]);
    expect(s.percentages).toEqual([50, 25, 0, 25, 0]);
    expect(s.recommendPercent).toBe(75);
    expect(s.verifiedCount).toBe(2);
  });

  it("clamps out-of-range ratings instead of breaking the bars", () => {
    const s = summarizeReviews([review({ rating: 9 }), review({ rating: 0 })]);
    expect(s.distribution).toEqual([1, 0, 0, 0, 1]);
  });
});

describe("sortReviews + formatRating", () => {
  const rows = [
    review({ rating: 3, helpful_count: 2, created_at: "2026-01-03T00:00:00Z", body: "mid" }),
    review({ rating: 5, helpful_count: 9, created_at: "2026-01-01T00:00:00Z", body: "top" }),
    review({ rating: 1, helpful_count: 0, created_at: "2026-01-02T00:00:00Z", body: "low" }),
  ];
  it("sorts without mutating the input", () => {
    const before = rows.map((r) => r.body);
    expect(sortReviews(rows, "newest").map((r) => r.body)).toEqual(["mid", "low", "top"]);
    expect(sortReviews(rows, "highest").map((r) => r.body)).toEqual(["top", "mid", "low"]);
    expect(sortReviews(rows, "lowest").map((r) => r.body)).toEqual(["low", "mid", "top"]);
    expect(sortReviews(rows, "helpful").map((r) => r.body)).toEqual(["top", "mid", "low"]);
    expect(rows.map((r) => r.body)).toEqual(before);
  });

  it("formats averages without trailing .0", () => {
    expect(formatRating(4)).toBe("4");
    expect(formatRating(4.666)).toBe("4.7");
    expect(formatRating(0)).toBe("0");
  });
});

describe("Stars placement (fractional fill must not squeeze the icons)", () => {
  it("keeps both star rows at natural width inside the %-width clip", () => {
    // Regression: the filled row used to be a plain `flex` box, so it
    // adopted the clip's 80% width and flex shrank its SVGs — 4/5 showed
    // five tiny gold stars bunched beside full-size grey ones.
    const html = renderToStaticMarkup(createElement(Stars, { value: 4, starClassName: "size-3.5" }));

    expect(html).toContain('aria-label="Rated 4 out of 5 stars"');
    expect(html).toContain('style="width:80%"');
    expect(html.match(/flex w-max shrink-0/g) ?? []).toHaveLength(2);
    expect(html.match(/shrink-0 size-3\.5/g) ?? []).toHaveLength(10);
  });

  it("clamps fractional and out-of-range values", () => {
    expect(renderToStaticMarkup(createElement(Stars, { value: 4.3 }))).toContain('style="width:86%"');
    expect(renderToStaticMarkup(createElement(Stars, { value: 9 }))).toContain('style="width:100%"');
    expect(renderToStaticMarkup(createElement(Stars, { value: -2 }))).toContain('style="width:0%"');
  });
});
