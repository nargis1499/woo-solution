"use client";

import { TicketPercentIcon, TruckIcon } from "lucide-react";
import { calculateShippingMicros, getShippingThresholdStatus } from "@/lib/config";
import { useCartStore } from "@/lib/cart-store";
import { formatMoney } from "@/lib/money";
import { Separator } from "@/components/ui/separator";
import { useMoney, useShipping } from "./money-provider";

/**
 * The money column shared by the cart and checkout summaries.
 *
 * When a coupon preview is in the cart store its saving shows as its own
 * green row (clamped to the subtotal) and a free-shipping coupon or configured
 * free-shipping threshold zeroes the shipping row – the same shape
 * `place_order()` stamps on the order.
 */
export function CartTotals({ subtotalMicros, note = true }: { subtotalMicros: number; note?: boolean }) {
  const money = useMoney();
  const shippingConfig = useShipping();
  const coupon = useCartStore((s) => s.coupon);
  const formatPrice = (cents: number) => formatMoney(cents, money);

  const discount = coupon ? Math.min(Math.max(0, coupon.discountMicros), subtotalMicros) : 0;
  const discountedSubtotal = subtotalMicros - discount;
  const shipping = coupon?.freeShipping ? 0 : calculateShippingMicros(discountedSubtotal, shippingConfig);
  const thresholdStatus = getShippingThresholdStatus(discountedSubtotal, shippingConfig);
  const total = discountedSubtotal + shipping;

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="font-medium tabular-nums">{formatPrice(subtotalMicros)}</dd>
      </div>
      {coupon && (discount > 0 || coupon.freeShipping) && (
        <div className="flex justify-between text-emerald-600 dark:text-emerald-400" data-testid="cart-discount-row">
          <dt className="inline-flex items-center gap-1.5 font-medium">
            <TicketPercentIcon className="size-3.5" aria-hidden />
            Coupon <span className="font-mono text-xs font-bold">{coupon.code}</span>
          </dt>
          <dd className="font-semibold tabular-nums" data-testid="cart-discount-amount">
            {discount > 0 ? `−${formatPrice(discount)}` : formatPrice(0)}
          </dd>
        </div>
      )}
      {shippingConfig.enabled && (
        <div className="flex justify-between" data-testid="cart-shipping-row">
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="font-medium tabular-nums" data-testid="cart-shipping-amount">
            {shipping === 0 ? "Free" : formatPrice(shipping)}
          </dd>
        </div>
      )}
      {note && subtotalMicros > 0 && shippingConfig.enabled && (
        <div className="space-y-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground" data-testid="cart-shipping-note">
          <p className="flex items-center gap-2">
            <TruckIcon className="size-3.5 shrink-0" aria-hidden />
            {coupon?.freeShipping
              ? `Free shipping unlocked by ${coupon.code}.`
              : thresholdStatus?.unlocked
                ? `Free shipping unlocked on orders of ${formatPrice(thresholdStatus.thresholdMicros)}+!`
                : thresholdStatus
                  ? `Add ${formatPrice(thresholdStatus.remainingMicros)} more for free shipping (flat rate ${formatPrice(shipping)}).`
                  : shipping === 0
                    ? "Free shipping applied to your order."
                    : `Flat-rate shipping (${formatPrice(shipping)}) at checkout.`}
          </p>
          {!coupon?.freeShipping && thresholdStatus && !thresholdStatus.unlocked && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-background/70"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={thresholdStatus.progressPercent}
              aria-label="Progress toward free shipping"
              data-testid="cart-free-shipping-progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${thresholdStatus.progressPercent}%` }}
              />
            </div>
          )}
        </div>
      )}
      <Separator className="my-1" />
      <div className="flex justify-between text-base">
        <dt className="font-semibold">Total</dt>
        <dd className="font-bold tabular-nums" data-testid="cart-total-amount">{formatPrice(total)}</dd>
      </div>
      {discount > 0 && (
        <p className="text-right text-xs font-medium text-emerald-600 dark:text-emerald-400">
          You&apos;re saving {formatPrice(discount)} on this order
        </p>
      )}
    </dl>
  );
}
