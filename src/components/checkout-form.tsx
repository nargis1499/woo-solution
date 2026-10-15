"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BanknoteIcon, CreditCardIcon, ShoppingCartIcon } from "lucide-react";
import { placeOrder } from "@/app/(store)/checkout/actions";
import { selectCartSubtotal, useCartStore, useHydrated } from "@/lib/cart-store";
import { formatPrice } from "@/lib/format";
import type { CurrentUser } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
    return <Skeleton className="h-64 w-full rounded-xl" aria-busy />;
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingCartIcon />
          </EmptyMedia>
          <EmptyTitle>Your cart is empty</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <LinkButton href="/shop">Return to shop</LinkButton>
        </EmptyContent>
      </Empty>
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
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Shipping details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="name">Full name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required defaultValue={user.name ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input id="email" value={user.email ?? ""} disabled />
              </Field>
              <Field>
                <FieldLabel htmlFor="phone">Phone</FieldLabel>
                <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+1 555 000 0000" />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="address_line1">Street address</FieldLabel>
                <Input id="address_line1" name="address_line1" autoComplete="address-line1" required placeholder="House number and street name" />
                <Input id="address_line2" name="address_line2" autoComplete="address-line2" placeholder="Apartment, suite, unit, etc. (optional)" aria-label="Address line 2" />
              </Field>
              <Field>
                <FieldLabel htmlFor="city">City</FieldLabel>
                <Input id="city" name="city" autoComplete="address-level2" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="postal_code">Postcode / ZIP</FieldLabel>
                <Input id="postal_code" name="postal_code" autoComplete="postal-code" />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="country">Country</FieldLabel>
                <Input id="country" name="country" autoComplete="country-name" required />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="notes">Order notes</FieldLabel>
                <Textarea id="notes" name="notes" placeholder="Notes about your order, e.g. special notes for delivery." />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup name="payment_method" defaultValue="cod" aria-label="Payment method" className="gap-3">
              <FieldLabel htmlFor="pay-cod">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle className="flex items-center gap-2">
                      <BanknoteIcon className="size-4 text-muted-foreground" aria-hidden /> Cash on delivery
                    </FieldTitle>
                    <FieldDescription>Pay with cash when your order is delivered.</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="cod" id="pay-cod" />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="pay-card" className="opacity-60">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle className="flex items-center gap-2">
                      <CreditCardIcon className="size-4 text-muted-foreground" aria-hidden /> Credit / debit card
                    </FieldTitle>
                    <FieldDescription>Coming soon (Stripe integration).</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="card" id="pay-card" isDisabled />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </CardContent>
        </Card>
      </div>

      {/* ── Order summary ────────────────────────────────────────────── */}
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Your order</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.productId} className="flex items-center gap-3 py-3 text-sm">
                <div className="w-14 shrink-0 overflow-hidden rounded-md">
                  <ProductImage src={item.imageUrl} alt={item.name} sizes="56px" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-snug font-medium">{item.name}</p>
                  <p className="text-muted-foreground">× {item.quantity}</p>
                </div>
                <p className="font-medium tabular-nums">{formatPrice(item.priceCents * item.quantity)}</p>
              </li>
            ))}
          </ul>
          <Separator className="my-4" />
          <CartTotals subtotalCents={subtotal} note={false} />
        </CardContent>
        <CardFooter className="flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Order could not be placed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" className="w-full" isPending={pending}>
            {pending ? "Placing order…" : "Place order"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Final prices and stock are verified securely on the server.</p>
        </CardFooter>
      </Card>
    </form>
  );
}
