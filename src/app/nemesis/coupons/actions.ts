"use server";

import { redirect } from "next/navigation";
import {
  UUID_RE,
  adminClient,
  bool,
  echo,
  failure,
  friendlyError,
  isRedirectError,
  notice,
  returnTo,
  revalidateStore,
  str,
  type AdminFormState,
} from "@/lib/admin/form";
import { COUPON_CODE_RE, generateCouponCode, isMissingCouponsSchema, normalizeCouponCode } from "@/lib/coupons";
import { USD_MONEY, isCurrencyCode, parseMoneyInput, toBaseMicros, type Money } from "@/lib/money";
import type { CouponDiscountType, CouponScopeType } from "@/lib/types";

export type { AdminFormState } from "@/lib/admin/form";

const LIST_PATH = "/nemesis/coupons";
const MIGRATION_HINT = "The coupon tables are missing – run supabase/migrations/20261061000000_coupons_reviews.sql in the Supabase SQL Editor, then try again.";

function couponError(e: unknown): string {
  if (isMissingCouponsSchema(e as { code?: string; message?: string })) return MIGRATION_HINT;
  const record = typeof e === "object" && e !== null ? (e as { code?: unknown; message?: unknown }) : null;
  if (record?.code === "23505") return "That coupon code already exists. Please pick another one.";
  if (typeof record?.message === "string" && /coupons_code_upper_idx/.test(record.message)) {
    return "That coupon code already exists. Please pick another one.";
  }
  return friendlyError(e);
}

/** The currency the coupon form displayed amounts in (hidden `money_*` fields, like products). */
function formMoney(formData: FormData): Money {
  const currency = str(formData, "money_currency", 10);
  const rate = Number(str(formData, "money_rate", 20));
  return isCurrencyCode(currency) && currency !== "USD" && Number.isFinite(rate) && rate > 0 ? { currency, rate } : USD_MONEY;
}

const moneyField = (fd: FormData, key: string, money: Money): { micros: number | null; invalid: boolean } => {
  const minor = parseMoneyInput(str(fd, key, 30));
  if (minor === null) return { micros: null, invalid: false };
  if (Number.isNaN(minor)) return { micros: null, invalid: true };
  const micros = toBaseMicros(minor, money);
  return { micros, invalid: !Number.isSafeInteger(micros) || micros < 0 };
};

const intField = (fd: FormData, key: string): { value: number | null; invalid: boolean } => {
  const raw = str(fd, key, 12);
  if (!raw) return { value: null, invalid: false };
  const n = Number(raw);
  return { value: n, invalid: !Number.isInteger(n) || n < 1 || n > 1_000_000 };
};

const dateField = (fd: FormData, key: string): { value: string | null; invalid: boolean } => {
  const raw = str(fd, key, 30);
  if (!raw) return { value: null, invalid: false };
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? { value: null, invalid: true } : { value: date.toISOString(), invalid: false };
};

export async function saveCoupon(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const values = echo(formData);
  const id = str(formData, "id", 40);
  const isEdit = Boolean(id);
  if (isEdit && !UUID_RE.test(id)) return { error: "Invalid coupon id.", values };
  const money = formMoney(formData);
  const fieldErrors: Record<string, string> = {};

  const code = normalizeCouponCode(str(formData, "code", 40));
  const description = str(formData, "description", 200) || null;
  const discountTypeRaw = str(formData, "discount_type", 10);
  const discount_type: CouponDiscountType = discountTypeRaw === "fixed" ? "fixed" : "percent";
  const free_shipping = bool(formData, "free_shipping");
  const first_order_only = bool(formData, "first_order_only");
  const is_active = bool(formData, "is_active");

  const percentInput = str(formData, "percent_off", 10).replace(",", ".");
  const percent = percentInput ? Number(percentInput) : null;
  const amount = moneyField(formData, "amount_off", money);
  const minSpend = moneyField(formData, "min_subtotal", money);
  const maxDiscount = moneyField(formData, "max_discount", money);
  const usageLimit = intField(formData, "usage_limit");
  const perUserLimit = intField(formData, "per_user_limit");
  const starts = dateField(formData, "starts_at");
  const expires = dateField(formData, "expires_at");

  const scopeRaw = str(formData, "scope_type", 12);
  const scope_type: CouponScopeType = scopeRaw === "categories" || scopeRaw === "products" ? scopeRaw : "all";
  const scope_ids = formData
    .getAll("scope_ids")
    .filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
    .slice(0, 200);

  if (!COUPON_CODE_RE.test(code)) fieldErrors.code = "Use 3–40 letters, numbers, dashes or underscores (e.g. WELCOME10).";
  if (discount_type === "percent") {
    if (!free_shipping && (percent === null || Number.isNaN(percent))) fieldErrors.percent_off = "Enter the percentage off.";
    else if (percent !== null && (Number.isNaN(percent) || percent <= 0 || percent > 100)) fieldErrors.percent_off = "Enter a percentage between 0 and 100.";
  } else {
    if (!free_shipping && amount.micros === null && !amount.invalid) fieldErrors.amount_off = "Enter the amount off.";
    if (amount.invalid) fieldErrors.amount_off = "Enter a valid amount.";
  }
  if (free_shipping === false && discount_type === "percent" && percent === null && !fieldErrors.percent_off) {
    fieldErrors.percent_off = "Enter the percentage off, or turn on free shipping.";
  }
  if (minSpend.invalid) fieldErrors.min_subtotal = "Enter a valid amount or leave it empty.";
  if (maxDiscount.invalid) fieldErrors.max_discount = "Enter a valid amount or leave it empty.";
  if (usageLimit.invalid) fieldErrors.usage_limit = "Enter a whole number of uses, or leave it empty for unlimited.";
  if (perUserLimit.invalid) fieldErrors.per_user_limit = "Enter how many times each customer may use this coupon.";
  if (starts.invalid) fieldErrors.starts_at = "Enter a valid start date, or leave it empty.";
  if (expires.invalid) fieldErrors.expires_at = "Enter a valid expiry date, or leave it empty.";
  if (starts.value && expires.value && expires.value <= starts.value) fieldErrors.expires_at = "The expiry must be after the start date.";
  if (scope_type !== "all" && scope_ids.length === 0) fieldErrors.scope_ids = `Pick at least one ${scope_type === "categories" ? "category" : "product"}, or apply the coupon to the whole order.`;
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  const row = {
    code,
    description,
    discount_type,
    percent_off: discount_type === "percent" ? percent : null,
    amount_off_micros: discount_type === "fixed" ? amount.micros : null,
    max_discount_micros: maxDiscount.micros,
    min_subtotal_micros: minSpend.micros ?? 0,
    free_shipping,
    scope_type,
    scope_ids: scope_type === "all" ? [] : scope_ids,
    first_order_only,
    starts_at: starts.value,
    expires_at: expires.value,
    usage_limit: usageLimit.value,
    per_user_limit: perUserLimit.value ?? 1,
    is_active,
  };

  try {
    const { supabase } = await adminClient();
    if (scope_type !== "all") {
      const table = scope_type === "categories" ? "categories" : "products";
      const { data: found, error } = await supabase.from(table).select("id").in("id", row.scope_ids);
      if (error) throw error;
      if ((found ?? []).length !== row.scope_ids.length) {
        return { error: "Please fix the highlighted fields.", fieldErrors: { scope_ids: "One of the selected items no longer exists – please pick again." }, values };
      }
    }
    const result = isEdit
      ? await supabase.from("coupons").update(row).eq("id", id).select("id").single()
      : await supabase.from("coupons").insert(row).select("id").single();
    if (result.error) throw result.error;
    revalidateStore();
    redirect(notice(LIST_PATH, isEdit ? `Coupon ${code} updated.` : `Coupon ${code} created.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const message = couponError(e);
    if (message.includes("already exists")) return { error: "Please fix the highlighted fields.", fieldErrors: { code: message }, values };
    return { error: message, values };
  }
}

/** Pause / resume a coupon from the list without opening the editor. */
export async function toggleCoupon(formData: FormData): Promise<void> {
  const back = returnTo(formData, LIST_PATH);
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid coupon id."));
  try {
    const { supabase } = await adminClient();
    const { data: coupon, error } = await supabase.from("coupons").select("code, is_active").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!coupon) redirect(failure(back, "Coupon not found."));
    const { error: updateError } = await supabase.from("coupons").update({ is_active: !coupon!.is_active }).eq("id", id);
    if (updateError) throw updateError;
    revalidateStore();
    redirect(notice(back, coupon!.is_active ? `Coupon ${coupon!.code} paused.` : `Coupon ${coupon!.code} is active again.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, couponError(e)));
  }
}

/** Clone a coupon under a fresh code (usage counters start again). */
export async function duplicateCoupon(formData: FormData): Promise<void> {
  const back = returnTo(formData, LIST_PATH);
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) redirect(failure(back, "Invalid coupon id."));
  try {
    const { supabase } = await adminClient();
    const { data: coupon, error } = await supabase.from("coupons").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!coupon) redirect(failure(back, "Coupon not found."));
    const source = coupon as unknown as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...source };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    copy.times_redeemed = 0;
    copy.code = generateCouponCode(String(source.code ?? "SAVE").split("-")[0] || "SAVE");
    copy.is_active = false;
    const { data: created, error: insertError } = await supabase.from("coupons").insert(copy).select("id").single();
    if (insertError) throw insertError;
    revalidateStore();
    redirect(notice(`/nemesis/coupons/${created.id}`, `Copied as ${String(copy.code)} (paused) – review and activate when ready.`));
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(failure(back, couponError(e)));
  }
}

export async function deleteCoupon(formData: FormData): Promise<AdminFormState> {
  const back = str(formData, "return_to", 600) ? returnTo(formData, LIST_PATH) : null;
  const id = str(formData, "id", 40);
  if (!UUID_RE.test(id)) {
    if (back) redirect(failure(back, "Invalid coupon id."));
    return { error: "Invalid coupon id." };
  }
  try {
    const { supabase } = await adminClient();
    const { data: coupon, error } = await supabase.from("coupons").select("code").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!coupon) {
      if (back) redirect(failure(back, "Coupon not found."));
      return { error: "That coupon no longer exists – the list has been refreshed." };
    }
    const { error: delError } = await supabase.from("coupons").delete().eq("id", id);
    if (delError) throw delError;
    revalidateStore();
    const message = `Coupon ${coupon!.code} deleted. Past orders keep the discount they were placed with.`;
    if (back) redirect(notice(back, message));
    return { success: message };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (back) redirect(failure(back, couponError(e)));
    return { error: couponError(e) };
  }
}
