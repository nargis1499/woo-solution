"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BadgePercentIcon, CheckCircle2Icon, LoaderCircleIcon, TicketPercentIcon, TruckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { previewCoupon } from "@/app/(store)/checkout/actions";
import { formatMoney } from "@/lib/money";
import { normalizeCouponCode } from "@/lib/coupons";
import { useCartStore } from "@/lib/cart-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMoney } from "./money-provider";

type CouponItem = { productId: string; variationId?: string | null; quantity: number };

/**
 * The cart/checkout promo-code box (migration 20261061).
 *
 * Applying asks the server to price the code against the live cart
 * (`previewCoupon` → `preview_coupon()`); the snapshot lives in the cart
 * store so the totals everywhere agree. Whenever the cart changes the code
 * is quietly re-priced – a coupon that stops applying is removed with a
 * toast instead of silently showing a stale saving. Checkout only sends
 * the code; `place_order()` decides the real discount.
 */
export function CouponField({ items }: { items: CouponItem[] }) {
  const money = useMoney();
  const coupon = useCartStore((s) => s.coupon);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [checking, setChecking] = useState(false);

  const itemsSignature = items.map((i) => `${i.productId}:${i.variationId ?? ""}x${i.quantity}`).join("|");
  const appliedCode = coupon?.code ?? null;
  const firstRun = useRef(true);

  // Re-price the applied code whenever the cart under it changes.
  useEffect(() => {
    if (!appliedCode || items.length === 0) return;
    if (firstRun.current) {
      firstRun.current = false;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      const result = await previewCoupon({
        code: appliedCode,
        items: items.map((i) => ({ product_id: i.productId, variation_id: i.variationId ?? null, quantity: i.quantity })),
      });
      if (cancelled) return;
      setChecking(false);
      if (result.ok) {
        setCoupon(result.coupon);
      } else {
        setCoupon(null);
        toast.error(`Coupon ${appliedCode} removed: ${result.error}`);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // itemsSignature is the stable representation of `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSignature, appliedCode]);

  if (coupon) {
    const savingLabel =
      coupon.discountMicros > 0
        ? `You save ${formatMoney(coupon.discountMicros, money)}`
        : "Free shipping applied";
    return (
      <div
        className="relative overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
        data-testid="applied-coupon"
      >
        <span className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full bg-card" aria-hidden />
        <span className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full bg-card" aria-hidden />
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
            <TicketPercentIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-sm font-bold tracking-wide">{coupon.code}</span>
              {coupon.percentOff ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
                  <BadgePercentIcon className="size-3" aria-hidden />
                  {coupon.percentOff}% off
                </span>
              ) : null}
              {coupon.freeShipping ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
                  <TruckIcon className="size-3" aria-hidden />
                  Free shipping
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {checking ? "Updating your saving…" : (coupon.description ?? savingLabel)}
              {coupon.description ? ` · ${savingLabel}` : ""}
            </p>
          </div>
          {checking ? (
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" aria-hidden />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove coupon ${coupon.code}`}
            onPress={() => {
              setCoupon(null);
              setCode("");
              setError(null);
            }}
          >
            <XIcon />
          </Button>
        </div>
      </div>
    );
  }

  function apply() {
    const normalized = normalizeCouponCode(code);
    setError(null);
    if (!normalized) {
      setError("Enter a coupon code.");
      return;
    }
    startTransition(async () => {
      const result = await previewCoupon({
        code: normalized,
        items: items.map((i) => ({ product_id: i.productId, variation_id: i.variationId ?? null, quantity: i.quantity })),
      });
      if (result.ok) {
        setCoupon(result.coupon);
        toast.success(
          result.coupon.discountMicros > 0
            ? `Coupon applied — you save ${formatMoney(result.coupon.discountMicros, money)}.`
            : "Coupon applied — free shipping is on us.",
        );
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-2" data-testid="coupon-field">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <TicketPercentIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
            placeholder="Coupon code"
            aria-label="Coupon code"
            aria-invalid={Boolean(error) || undefined}
            maxLength={40}
            className="border-dashed pl-9 font-mono tracking-wide uppercase placeholder:font-sans placeholder:normal-case"
          />
        </div>
        <Button type="button" variant="outline" isDisabled={pending || items.length === 0} onPress={apply}>
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Checking…" : "Apply"}
        </Button>
      </div>
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Have a promo code? Apply it and watch the total drop.</p>
      )}
    </div>
  );
}
