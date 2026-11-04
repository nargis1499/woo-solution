import { formatMoney, type Money } from "@/lib/money";
import type { Coupon, CouponDiscountType } from "@/lib/types";

/**
 * Coupon rules shared by the storefront, the Nemesis admin and the tests.
 *
 * The database is the source of truth (`preview_coupon()` / `place_order()`
 * in migration 20261061 re-price everything server-side); the helpers here
 * mirror that maths for display and form logic only.
 */

export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9-_]{2,39}$/;

/** Codes are stored/shared uppercase; customers may type them in any case. */
export function normalizeCouponCode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A customer-friendly random code, e.g. `SAVE-K7QX2P` (no 0/O/1/I/L). */
export function generateCouponCode(prefix = "SAVE"): string {
  const clean = normalizeCouponCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SAVE";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${clean}-${suffix}`;
}

export function percentOffNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type DiscountRules = {
  discount_type: CouponDiscountType;
  percent_off?: number | string | null;
  amount_off_micros?: number | null;
  max_discount_micros?: number | null;
};

/** Mirror of `public.coupon_discount_for()` — percent floors, fixed caps at the eligible total. */
export function computeDiscountMicros(rules: DiscountRules, eligibleMicros: number): number {
  const eligible = Math.max(0, Math.floor(eligibleMicros || 0));
  if (eligible <= 0) return 0;
  let discount = 0;
  if (rules.discount_type === "percent") {
    const percent = percentOffNumber(rules.percent_off);
    if (percent) discount = Math.floor((eligible * percent) / 100);
  } else if (rules.amount_off_micros != null) {
    discount = Math.min(Math.max(0, rules.amount_off_micros), eligible);
  }
  if (rules.max_discount_micros != null) discount = Math.min(discount, Math.max(0, rules.max_discount_micros));
  return Math.max(0, Math.min(discount, eligible));
}

export type CouponStatus = "active" | "scheduled" | "expired" | "exhausted" | "disabled";

export function couponStatus(
  coupon: Pick<Coupon, "is_active" | "starts_at" | "expires_at" | "usage_limit" | "times_redeemed">,
  now: Date = new Date(),
): CouponStatus {
  if (!coupon.is_active) return "disabled";
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return "scheduled";
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) return "expired";
  if (coupon.usage_limit != null && coupon.times_redeemed >= coupon.usage_limit) return "exhausted";
  return "active";
}

export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  exhausted: "Exhausted",
  disabled: "Disabled",
};

/** "20% off" / "$15.00 off" / "Free shipping" / "10% off + free shipping". */
export function describeCoupon(
  coupon: Pick<Coupon, "discount_type" | "percent_off" | "amount_off_micros" | "free_shipping">,
  money: Money,
): string {
  const parts: string[] = [];
  if (coupon.discount_type === "percent") {
    const percent = percentOffNumber(coupon.percent_off);
    if (percent) parts.push(`${Number.isInteger(percent) ? percent : percent.toFixed(1)}% off`);
  } else if (coupon.amount_off_micros != null) {
    parts.push(`${formatMoney(coupon.amount_off_micros, money)} off`);
  }
  if (coupon.free_shipping) parts.push(parts.length ? "free shipping" : "Free shipping");
  return parts.length ? parts.join(" + ") : "Discount";
}

/** 0–100 for the admin usage bar; `null` usage limit reads as 0 (unlimited). */
export function couponUsagePercent(coupon: Pick<Coupon, "usage_limit" | "times_redeemed">): number {
  if (coupon.usage_limit == null || coupon.usage_limit <= 0) return 0;
  return Math.min(100, Math.round((coupon.times_redeemed / coupon.usage_limit) * 100));
}

/**
 * What the cart keeps after a successful `preview_coupon()` call. It is a
 * display snapshot — checkout sends only the code and the database decides
 * the real discount.
 */
export type AppliedCoupon = {
  code: string;
  description: string | null;
  discountMicros: number;
  freeShipping: boolean;
  discountType: CouponDiscountType;
  percentOff: number | null;
  expiresAt: string | null;
};

type QueryError = { code?: string; message?: string } | null | undefined;

/** A database that has not run migration 20261061 yet (coupon features simply stay off). */
export function isMissingCouponsSchema(error: QueryError): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.code ?? ""}`;
  return (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    /coupons|coupon_redemptions|preview_coupon/i.test(text) && /does not exist|schema cache|Could not find/i.test(text)
  );
}

/** `place_order` still has the pre-coupon 2-argument signature. */
export function isMissingCouponCheckout(error: QueryError): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.code ?? ""}`;
  return error.code === "PGRST202" || (/place_order/i.test(text) && /p_coupon_code|Could not find the function/i.test(text));
}
