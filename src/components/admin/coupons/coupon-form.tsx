"use client";

import { useActionState, useMemo, useState } from "react";
import { DicesIcon, TicketPercentIcon } from "lucide-react";
import { saveCoupon } from "@/app/nemesis/coupons/actions";
import type { AdminFormState } from "@/lib/admin/form";
import { generateCouponCode } from "@/lib/coupons";
import { inputFromMicros, type Money } from "@/lib/money";
import type { Category, Coupon, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton, SwitchField } from "@/components/admin/form-bits";

export type CouponScopeOption = Pick<Category, "id" | "name"> | Pick<Product, "id" | "name">;

/** `datetime-local` value for an ISO timestamp (local time, seconds dropped). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const moneyInput = (micros: number | null | undefined, money: Money): string =>
  micros == null || micros === 0 ? "" : inputFromMicros(micros, money);

/**
 * The coupon editor (Nemesis → Coupons). Money fields are typed in the
 * store's display currency; hidden `money_*` inputs tell the action which
 * currency that was, exactly like the product form.
 */
export function CouponForm({
  coupon,
  money,
  categories,
  products,
}: {
  coupon?: Coupon | null;
  money: Money;
  categories: CouponScopeOption[];
  products: CouponScopeOption[];
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(saveCoupon, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const symbol = money.currency === "BDT" ? "৳" : "$";

  const [code, setCode] = useState(v.code ?? coupon?.code ?? "");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    v.discount_type === "fixed" || coupon?.discount_type === "fixed" ? "fixed" : "percent",
  );
  const [scopeType, setScopeType] = useState<"all" | "categories" | "products">(
    v.scope_type === "categories" || v.scope_type === "products" ? v.scope_type : (coupon?.scope_type ?? "all"),
  );
  const [scopeQuery, setScopeQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(coupon?.scope_ids ?? []);

  const scopeOptions = scopeType === "categories" ? categories : products;
  const filteredScopeOptions = useMemo(() => {
    const q = scopeQuery.trim().toLowerCase();
    const base = q ? scopeOptions.filter((o) => o.name.toLowerCase().includes(q)) : scopeOptions;
    return base.slice(0, 60);
  }, [scopeOptions, scopeQuery]);

  const segment = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {coupon ? <input type="hidden" name="id" value={coupon.id} /> : null}
      <input type="hidden" name="money_currency" value={money.currency} />
      <input type="hidden" name="money_rate" value={money.rate} />
      <input type="hidden" name="discount_type" value={discountType} />
      <input type="hidden" name="scope_type" value={scopeType} />
      {picked.map((id) => (
        <input key={id} type="hidden" name="scope_ids" value={id} />
      ))}

      {/* Code */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(err.code) || undefined}>
          <FieldLabel htmlFor="coupon-code">Coupon code</FieldLabel>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <TicketPercentIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="coupon-code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="WELCOME10"
                maxLength={40}
                required
                className="pl-9 font-mono tracking-wide uppercase"
                aria-invalid={Boolean(err.code) || undefined}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onPress={() => setCode(generateCouponCode(code.split("-")[0] || "SAVE"))}
              aria-label="Generate a random code"
            >
              <DicesIcon /> Generate
            </Button>
          </div>
          <FieldDescription>Customers type this at the cart or checkout. Case does not matter.</FieldDescription>
          <FieldError>{err.code}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="coupon-description">Description (optional)</FieldLabel>
          <Textarea
            id="coupon-description"
            name="description"
            rows={2}
            maxLength={200}
            placeholder="e.g. Welcome treat for new customers"
            defaultValue={v.description ?? coupon?.description ?? ""}
          />
          <FieldDescription>Shown to the customer when the coupon is applied.</FieldDescription>
        </Field>
      </div>

      {/* Discount */}
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Discount</p>
          <div className="flex max-w-sm gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Discount type">
            <button type="button" role="tab" aria-selected={discountType === "percent"} className={segment(discountType === "percent")} onClick={() => setDiscountType("percent")}>
              Percentage
            </button>
            <button type="button" role="tab" aria-selected={discountType === "fixed"} className={segment(discountType === "fixed")} onClick={() => setDiscountType("fixed")}>
              Fixed amount
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {discountType === "percent" ? (
            <Field data-invalid={Boolean(err.percent_off) || undefined}>
              <FieldLabel htmlFor="coupon-percent">Percentage off</FieldLabel>
              <div className="relative">
                <Input
                  id="coupon-percent"
                  name="percent_off"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="10"
                  defaultValue={v.percent_off ?? (coupon?.percent_off != null ? String(Number(coupon.percent_off)) : "")}
                  className="pr-8 tabular-nums"
                  aria-invalid={Boolean(err.percent_off) || undefined}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
              <FieldError>{err.percent_off}</FieldError>
            </Field>
          ) : (
            <Field data-invalid={Boolean(err.amount_off) || undefined}>
              <FieldLabel htmlFor="coupon-amount">Amount off</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
                <Input
                  id="coupon-amount"
                  name="amount_off"
                  inputMode="decimal"
                  placeholder="15.00"
                  defaultValue={v.amount_off ?? moneyInput(coupon?.amount_off_micros, money)}
                  className="pl-7 tabular-nums"
                  aria-invalid={Boolean(err.amount_off) || undefined}
                />
              </div>
              <FieldError>{err.amount_off}</FieldError>
            </Field>
          )}

          <Field data-invalid={Boolean(err.min_subtotal) || undefined}>
            <FieldLabel htmlFor="coupon-min">Minimum spend (optional)</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
              <Input
                id="coupon-min"
                name="min_subtotal"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={v.min_subtotal ?? moneyInput(coupon?.min_subtotal_micros, money)}
                className="pl-7 tabular-nums"
                aria-invalid={Boolean(err.min_subtotal) || undefined}
              />
            </div>
            <FieldError>{err.min_subtotal}</FieldError>
          </Field>

          <Field data-invalid={Boolean(err.max_discount) || undefined}>
            <FieldLabel htmlFor="coupon-max">Max discount cap (optional)</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
              <Input
                id="coupon-max"
                name="max_discount"
                inputMode="decimal"
                placeholder="No cap"
                defaultValue={v.max_discount ?? moneyInput(coupon?.max_discount_micros, money)}
                className="pl-7 tabular-nums"
                aria-invalid={Boolean(err.max_discount) || undefined}
              />
            </div>
            <FieldError>{err.max_discount}</FieldError>
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <SwitchField id="coupon-free-shipping" name="free_shipping" label="Free shipping" defaultSelected={v.free_shipping ? v.free_shipping === "on" : (coupon?.free_shipping ?? false)} />
          <SwitchField id="coupon-first-order" name="first_order_only" label="First order only" defaultSelected={v.first_order_only ? v.first_order_only === "on" : (coupon?.first_order_only ?? false)} />
          <SwitchField id="coupon-active" name="is_active" label="Active" defaultSelected={v.is_active ? v.is_active === "on" : (coupon?.is_active ?? true)} />
        </div>
      </div>

      {/* Scope */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Applies to</p>
        <div className="flex max-w-md gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Coupon scope">
          {(
            [
              ["all", "Whole order"],
              ["categories", "Categories"],
              ["products", "Products"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scopeType === value}
              className={segment(scopeType === value)}
              onClick={() => {
                setScopeType(value);
                setPicked([]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {scopeType !== "all" ? (
          <div className="max-w-md space-y-2">
            <Input value={scopeQuery} onChange={(e) => setScopeQuery(e.target.value)} placeholder={`Search ${scopeType}…`} aria-label={`Search ${scopeType}`} />
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
              {filteredScopeOptions.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted-foreground">Nothing matches that search.</li>
              ) : (
                filteredScopeOptions.map((option) => {
                  const checked = picked.includes(option.id);
                  return (
                    <li key={option.id}>
                      <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors", checked ? "bg-primary/10 font-medium" : "hover:bg-accent")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={checked}
                          onChange={() => setPicked((current) => (checked ? current.filter((id) => id !== option.id) : [...current, option.id]))}
                        />
                        <span className="truncate">{option.name}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              {picked.length} selected. The discount (and minimum spend) only count matching items.
            </p>
          </div>
        ) : null}
        {err.scope_ids ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {err.scope_ids}
          </p>
        ) : null}
      </div>

      {/* Schedule + limits */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field data-invalid={Boolean(err.starts_at) || undefined}>
          <FieldLabel htmlFor="coupon-starts">Starts (optional)</FieldLabel>
          <Input id="coupon-starts" name="starts_at" type="datetime-local" defaultValue={v.starts_at ?? toLocalInput(coupon?.starts_at)} aria-invalid={Boolean(err.starts_at) || undefined} />
          <FieldError>{err.starts_at}</FieldError>
        </Field>
        <Field data-invalid={Boolean(err.expires_at) || undefined}>
          <FieldLabel htmlFor="coupon-expires">Expires (optional)</FieldLabel>
          <Input id="coupon-expires" name="expires_at" type="datetime-local" defaultValue={v.expires_at ?? toLocalInput(coupon?.expires_at)} aria-invalid={Boolean(err.expires_at) || undefined} />
          <FieldError>{err.expires_at}</FieldError>
        </Field>
        <Field data-invalid={Boolean(err.usage_limit) || undefined}>
          <FieldLabel htmlFor="coupon-usage">Total uses (optional)</FieldLabel>
          <Input
            id="coupon-usage"
            name="usage_limit"
            type="number"
            min={1}
            placeholder="Unlimited"
            defaultValue={v.usage_limit ?? (coupon?.usage_limit != null ? String(coupon.usage_limit) : "")}
            className="tabular-nums"
            aria-invalid={Boolean(err.usage_limit) || undefined}
          />
          <FieldError>{err.usage_limit}</FieldError>
        </Field>
        <Field data-invalid={Boolean(err.per_user_limit) || undefined}>
          <FieldLabel htmlFor="coupon-per-user">Uses per customer</FieldLabel>
          <Input
            id="coupon-per-user"
            name="per_user_limit"
            type="number"
            min={1}
            defaultValue={v.per_user_limit ?? String(coupon?.per_user_limit ?? 1)}
            className="tabular-nums"
            aria-invalid={Boolean(err.per_user_limit) || undefined}
          />
          <FieldError>{err.per_user_limit}</FieldError>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <SubmitButton pendingLabel="Saving…">{coupon ? "Save changes" : "Create coupon"}</SubmitButton>
        <LinkButton href="/nemesis/coupons" variant="outline">
          Cancel
        </LinkButton>
        {coupon ? (
          <p className="ml-auto self-center text-xs text-muted-foreground">
            Redeemed {coupon.times_redeemed} time{coupon.times_redeemed === 1 ? "" : "s"} so far. Editing never changes past orders.
          </p>
        ) : null}
      </div>
    </form>
  );
}
