import { FREE_SHIPPING_THRESHOLD_CENTS, calculateShippingCents } from "@/lib/config";
import { formatPrice } from "@/lib/format";

export function CartTotals({ subtotalCents, note = true }: { subtotalCents: number; note?: boolean }) {
  const shipping = calculateShippingCents(subtotalCents);
  const total = subtotalCents + shipping;
  const remaining = FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents;

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-neutral-600">Subtotal</dt>
        <dd className="font-medium">{formatPrice(subtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-neutral-600">Shipping</dt>
        <dd className="font-medium">{shipping === 0 ? "Free" : formatPrice(shipping)}</dd>
      </div>
      {note && subtotalCents > 0 && remaining > 0 && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800">
          Add {formatPrice(remaining)} more for free shipping.
        </p>
      )}
      <div className="flex justify-between border-t border-neutral-200 pt-3 text-base">
        <dt className="font-semibold">Total</dt>
        <dd className="font-bold">{formatPrice(total)}</dd>
      </div>
    </dl>
  );
}
