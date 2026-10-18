"use client";

import Link from "next/link";
import { useState } from "react";
import { HeartIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useHydrated } from "@/lib/cart-store";
import { selectWishlistCount, useWishlistStore, type WishlistItem } from "@/lib/wishlist-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Price } from "./price";
import { cn } from "@/lib/utils";

export function WishlistBadge() {
  const hydrated = useHydrated();
  const count = useWishlistStore(selectWishlistCount);
  const items = useWishlistStore((s) => s.items);
  const removeItem = useWishlistStore((s) => s.removeItem);
  const clear = useWishlistStore((s) => s.clear);
  const addCartItem = useCartStore((s) => s.addItem);
  const [open, setOpen] = useState(false);

  const shown = hydrated ? count : 0;

  function moveToCart(item: WishlistItem) {
    addCartItem(
      {
        productId: item.productId,
        variationId: null,
        variationLabel: null,
        slug: item.slug,
        name: item.name,
        priceMicros: item.priceMicros,
        imageUrl: item.imageUrl,
        stock: item.stock,
      },
      1,
    );
    toast.success(`"${item.name}" added to cart.`);
  }

  return (
    <SheetTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={`Wishlist, ${shown} item${shown === 1 ? "" : "s"}`}
        data-testid="wishlist-header-button"
      >
        <HeartIcon className={cn("size-5", shown > 0 && "fill-rose-500 text-rose-500")} />
        {shown > 0 && (
          <Badge className="absolute -top-1 -right-1 h-5 min-w-5 justify-center rounded-full px-1 text-[11px] tabular-nums">
            {shown > 99 ? "99+" : shown}
          </Badge>
        )}
      </Button>
      <Sheet side="right" className="flex w-full flex-col p-6 sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center justify-between pr-6">
            <SheetTitle className="flex items-center gap-2">
              <HeartIcon className="size-4 fill-rose-500 text-rose-500" />
              Wishlist ({shown})
            </SheetTitle>
            {shown > 0 && (
              <Button variant="ghost" size="xs" onPress={clear}>
                Clear all
              </Button>
            )}
          </div>
          <SheetDescription>Products you saved for later.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {!hydrated || items.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-3 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <HeartIcon className="size-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">Your wishlist is empty</p>
                <p className="text-xs text-muted-foreground">
                  Tap the heart icon on any product card to save it here.
                </p>
              </div>
              <Link
                href="/shop"
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Explore products
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-2xs"
                >
                  <Link
                    href={`/products/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted"
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="size-full object-cover"
                      />
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    {item.brand && (
                      <span className="block text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                        {item.brand}
                      </span>
                    )}
                    <Link
                      href={`/products/${item.slug}`}
                      onClick={() => setOpen(false)}
                      className="line-clamp-1 text-sm font-semibold hover:text-primary"
                    >
                      {item.name}
                    </Link>
                    <Price
                      micros={item.priceMicros}
                      regularMicros={item.compareAtPriceMicros}
                      className="mt-0.5 text-sm"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="xs"
                      className="rounded-lg !bg-primary !text-primary-foreground hover:!bg-primary/90 ![background-image:none]"
                      onPress={() => moveToCart(item)}
                    >
                      <ShoppingBagIcon className="size-3.5" /> Add
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${item.name}`}
                      onPress={() => removeItem(item.productId)}
                    >
                      <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </SheetTrigger>
  );
}
