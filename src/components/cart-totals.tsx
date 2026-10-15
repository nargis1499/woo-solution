import { TruckIcon } from "lucide-react";
import { FREE_SHIPPING_THRESHOLD_CENTS, calculateShippingCents } from "@/lib/config";
import { formatPrice } from "@/lib/format";
import { Separator } from "@/components/ui/separator";

export function CartTotals({ subtotalCents, note = true }: { subtotalCents: number; note?: boolean }) {
  const shipping = calculateShippingCents(subtotalCents);
  const total = subtotalCents + shipping;
  const remaining = FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents;

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="font-medium tabular-nums">{formatPrice(subtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Shipping</dt>
        <dd className="font-medium tabular-nums">{shipping === 0 ? "Free" : formatPrice(shipping)}</dd>
      </div>
      {note && subtotalCents > 0 && remaining > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
          <TruckIcon className="size-3.5 shrink-0" aria-hidden />
          Add {formatPrice(remaining)} more for free shipping.
        </p>
      )}
      <Separator className="my-1" />
      <div className="flex justify-between text-base">
        <dt className="font-semibold">Total</dt>
        <dd className="font-bold tabular-nums">{formatPrice(total)}</dd>
      </div>
    </dl>
  );
}
