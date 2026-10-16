"use client";

import Link from "next/link";
import { ArrowLeftIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react";
import { lineKey, selectCartSubtotal, useCartStore, useHydrated } from "@/lib/cart-store";
import { formatMoney } from "@/lib/money";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CartTotals } from "./cart-totals";
import { useMoney } from "./money-provider";
import { ProductImage } from "./product-image";
import { QuantityInput } from "./quantity-input";

export function CartView({ manageStock = true }: { manageStock?: boolean }) {
  const money = useMoney();
  const formatPrice = (cents: number) => formatMoney(cents, money);
  const hydrated = useHydrated();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore(selectCartSubtotal);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);

  if (!hydrated) {
    return <Skeleton className="h-48 w-full rounded-xl" aria-busy />;
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingCartIcon />
          </EmptyMedia>
          <EmptyTitle>Your cart is empty</EmptyTitle>
          <EmptyDescription>Looks like you haven&apos;t added anything yet.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <LinkButton href="/shop">Return to shop</LinkButton>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {items.map((item) => (
            <li key={lineKey(item)} className="flex gap-4 p-4 sm:p-5">
              <Link href={`/products/${item.slug}`} className="w-24 shrink-0 overflow-hidden rounded-lg sm:w-28">
                <ProductImage src={item.imageUrl} alt={item.name} sizes="112px" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/products/${item.slug}`} className="font-medium hover:text-primary">
                      {item.name}
                    </Link>
                    {item.variationLabel && <p className="text-xs text-muted-foreground">{item.variationLabel}</p>}
                    <p className="text-sm text-muted-foreground">{formatPrice(item.priceMicros)} each</p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatPrice(item.priceMicros * item.quantity)}</p>
                </div>
                <div className="mt-auto flex items-center justify-between gap-4">
                  <QuantityInput size="sm" value={item.quantity} max={manageStock ? (item.stock ?? undefined) : undefined} onChange={(q) => setQuantity(lineKey(item), q)} />
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onPress={() => removeItem(lineKey(item))}>
                    <Trash2Icon /> Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Separator />
        <CardFooter className="justify-between py-3">
          <LinkButton href="/shop" variant="link" className="px-0">
            <ArrowLeftIcon /> Continue shopping
          </LinkButton>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onPress={clear}>
            Clear cart
          </Button>
        </CardFooter>
      </Card>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Cart totals</CardTitle>
        </CardHeader>
        <CardContent>
          <CartTotals subtotalMicros={subtotal} />
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <LinkButton href="/checkout" size="lg" className="w-full">
            Proceed to checkout
          </LinkButton>
          <p className="text-center text-xs text-muted-foreground">Shipping is calculated at checkout.</p>
        </CardFooter>
      </Card>
    </div>
  );
}
