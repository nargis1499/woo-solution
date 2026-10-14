"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeOrder } from "@/app/checkout/actions";
import { selectCartSubtotal, useCartStore, useHydrated } from "@/lib/cart-store";
import { formatPrice } from "@/lib/format";
import type { CurrentUser } from "@/lib/types";
import { Button, ButtonLink } from "./ui/button";
import { FormError, Input, Label, Textarea } from "./ui/field";
import { CartTotals } from "./cart-totals";
import { ProductImage } from "./product-image";

export function CheckoutForm({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore(selectCartSubtotal);
  const clear = useCartStore((s) => s.clear);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!hydrated) {
    return <div className="card h-64 animate-pulse" aria-busy />;
  }

  if (items.length === 0) {
    return (
      <div className="card grid place-items-center gap-4 px-6 py-20 text-center">
        <p className="text-lg font-medium">Your cart is empty.</p>
        <ButtonLink href="/shop">Return to shop</ButtonLink>
      </div>
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();

    startTransition(async () => {
      const result = await placeOrder({
        items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        shipping: {
          name: field("name"),
          phone: field("phone"),
          address_line1: field("address_line1"),
          address_line2: field("address_line2"),
          city: field("city"),
          postal_code: field("postal_code"),
          country: field("country"),
          notes: field("notes"),
        },
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      clear();
      router.replace(`/orders/${result.orderId}?placed=1`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_400px]">
      {/* ── Shipping details ─────────────────────────────────────────── */}
      <section className="space-y-6">
        <div className="card p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Shipping details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name" required>Full name</Label>
              <Input id="name" name="name" autoComplete="name" required defaultValue={user.name ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" value={user.email ?? ""} disabled />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+1 555 000 0000" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="address_line1" required>Street address</Label>
              <Input id="address_line1" name="address_line1" autoComplete="address-line1" required placeholder="House number and street name" />
            </div>
            <div className="sm:col-span-2">
              <Input id="address_line2" name="address_line2" autoComplete="address-line2" placeholder="Apartment, suite, unit, etc. (optional)" />
            </div>
            <div>
              <Label htmlFor="city" required>City</Label>
              <Input id="city" name="city" autoComplete="address-level2" required />
            </div>
            <div>
              <Label htmlFor="postal_code">Postcode / ZIP</Label>
              <Input id="postal_code" name="postal_code" autoComplete="postal-code" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="country" required>Country</Label>
              <Input id="country" name="country" autoComplete="country-name" required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Order notes</Label>
              <Textarea id="notes" name="notes" placeholder="Notes about your order, e.g. special notes for delivery." />
            </div>
          </div>
        </div>

        <div className="card p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Payment</h2>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-brand-300 bg-brand-50 p-4">
            <input type="radio" name="payment_method" value="cod" defaultChecked className="mt-1 accent-brand-600" />
            <span>
              <span className="block font-medium">Cash on delivery</span>
              <span className="block text-sm text-neutral-600">Pay with cash when your order is delivered.</span>
            </span>
          </label>
          <label className="mt-3 flex cursor-not-allowed items-start gap-3 rounded-lg border border-neutral-200 p-4 opacity-60">
            <input type="radio" name="payment_method" value="card" disabled className="mt-1" />
            <span>
              <span className="block font-medium">Credit / debit card</span>
              <span className="block text-sm text-neutral-600">Coming soon (Stripe integration).</span>
            </span>
          </label>
        </div>
      </section>

      {/* ── Order summary ────────────────────────────────────────────── */}
      <aside className="card h-fit p-5 sm:p-6 lg:sticky lg:top-24">
        <h2 className="mb-4 text-lg font-semibold">Your order</h2>
        <ul className="mb-4 divide-y divide-neutral-200">
          {items.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 py-3 text-sm">
              <div className="w-14 shrink-0 overflow-hidden rounded-md">
                <ProductImage src={item.imageUrl} alt={item.name} sizes="56px" />
              </div>
              <div className="flex-1">
                <p className="font-medium leading-snug">{item.name}</p>
                <p className="text-neutral-500">× {item.quantity}</p>
              </div>
              <p className="font-medium">{formatPrice(item.priceCents * item.quantity)}</p>
            </li>
          ))}
        </ul>

        <CartTotals subtotalCents={subtotal} note={false} />

        <div className="mt-5 space-y-3">
          <FormError message={error ?? undefined} />
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Placing order…" : "Place order"}
          </Button>
          <p className="text-center text-xs text-neutral-500">
            Final prices and stock are verified securely on the server.
          </p>
        </div>
      </aside>
    </form>
  );
}
