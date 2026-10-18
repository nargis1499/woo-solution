"use client";

import { TruckIcon } from "lucide-react";
import { calculateShippingMicros } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { Separator } from "@/components/ui/separator";
import { useMoney, useShipping } from "./money-provider";

export function CartTotals({ subtotalMicros, note = true }: { subtotalMicros: number; note?: boolean }) {
  const money = useMoney();
  const shippingConfig = useShipping();
  const formatPrice = (cents: number) => formatMoney(cents, money);
  const shipping = calculateShippingMicros(subtotalMicros, shippingConfig);
  const total = subtotalMicros + shipping;

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="font-medium tabular-nums">{formatPrice(subtotalMicros)}</dd>
      </div>
      {shippingConfig.enabled && (
        <div className="flex justify-between" data-testid="cart-shipping-row">
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="font-medium tabular-nums" data-testid="cart-shipping-amount">
            {shipping === 0 ? "Free" : formatPrice(shipping)}
          </dd>
        </div>
      )}
      {note && subtotalMicros > 0 && shippingConfig.enabled && (
        <p className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
          <TruckIcon className="size-3.5 shrink-0" aria-hidden />
          {shipping === 0 ? "Free shipping applied to your order." : `Flat-rate shipping (${formatPrice(shipping)}) at checkout.`}
        </p>
      )}
      <Separator className="my-1" />
      <div className="flex justify-between text-base">
        <dt className="font-semibold">Total</dt>
        <dd className="font-bold tabular-nums" data-testid="cart-total-amount">{formatPrice(total)}</dd>
      </div>
    </dl>
  );
}
