"use client";

import Link from "next/link";
import { selectCartSubtotal, useCartStore, useHydrated } from "@/lib/cart-store";
import { formatPrice } from "@/lib/format";
import { ButtonLink } from "./ui/button";
import { CartTotals } from "./cart-totals";
import { ProductImage } from "./product-image";
import { QuantityInput } from "./quantity-input";
import { TrashIcon } from "./icons";

export function CartView() {
  const hydrated = useHydrated();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore(selectCartSubtotal);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);

  if (!hydrated) {
    return <div className="card h-48 animate-pulse" aria-busy />;
  }

  if (items.length === 0) {
    return (
      <div className="card grid place-items-center gap-4 px-6 py-20 text-center">
        <p className="text-lg font-medium">Your cart is empty.</p>
        <p className="text-sm text-neutral-500">Looks like you haven&apos;t added anything yet.</p>
        <ButtonLink href="/shop">Return to shop</ButtonLink>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section className="card divide-y divide-neutral-200">
        {items.map((item) => (
          <div key={item.productId} className="flex gap-4 p-4 sm:p-5">
            <Link href={`/products/${item.slug}`} className="w-24 shrink-0 overflow-hidden rounded-lg sm:w-28">
              <ProductImage src={item.imageUrl} alt={item.name} sizes="112px" />
            </Link>

            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link href={`/products/${item.slug}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                    {item.name}
                  </Link>
                  <p className="text-sm text-neutral-500">{formatPrice(item.priceCents)} each</p>
                </div>
                <p className="font-semibold">{formatPrice(item.priceCents * item.quantity)}</p>
              </div>

              <div className="mt-auto flex items-center justify-between gap-4">
                <QuantityInput
                  size="sm"
                  value={item.quantity}
                  max={item.stock}
                  onChange={(q) => setQuantity(item.productId, q)}
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.productId)}
                  className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" /> Remove
                </button>
              </div>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between p-4 text-sm sm:p-5">
          <Link href="/shop" className="font-medium text-brand-700 dark:text-brand-300 hover:underline">
            ← Continue shopping
          </Link>
          <button type="button" onClick={clear} className="text-neutral-500 hover:text-red-600">
            Clear cart
          </button>
        </div>
      </section>

      <aside className="card h-fit p-5 lg:sticky lg:top-24">
        <h2 className="mb-4 text-lg font-semibold">Cart totals</h2>
        <CartTotals subtotalCents={subtotal} />
        <ButtonLink href="/checkout" size="lg" className="mt-5 w-full">
          Proceed to checkout
        </ButtonLink>
        <p className="mt-3 text-center text-xs text-neutral-500">Shipping is calculated at checkout.</p>
      </aside>
    </div>
  );
}
