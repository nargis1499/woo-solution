"use client";

import { HeartIcon } from "lucide-react";
import { toast } from "sonner";
import { useHydrated } from "@/lib/cart-store";
import { selectIsWishlisted, useWishlistStore } from "@/lib/wishlist-store";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WishlistButton({
  product,
  className,
}: {
  product: Pick<
    Product,
    | "id"
    | "slug"
    | "name"
    | "brand"
    | "category"
    | "price_micros"
    | "compare_at_price_micros"
    | "image_url"
    | "stock"
  >;
  className?: string;
}) {
  const hydrated = useHydrated();
  const isSaved = useWishlistStore(selectIsWishlisted(product.id));
  const toggleItem = useWishlistStore((s) => s.toggleItem);
  const active = hydrated && isSaved;

  function handleClick() {
    const added = toggleItem({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand ?? null,
      categoryName: product.category?.name ?? null,
      priceMicros: product.price_micros,
      compareAtPriceMicros: product.compare_at_price_micros ?? null,
      imageUrl: product.image_url,
      stock: product.stock,
    });
    if (added) {
      toast.success(`"${product.name}" added to wishlist.`);
    } else {
      toast(`"${product.name}" removed from wishlist.`);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={active ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
      aria-pressed={active}
      data-testid="wishlist-toggle"
      data-wishlisted={active ? "true" : "false"}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-rose-500/35 bg-rose-500/10 text-rose-500 hover:bg-rose-500/15"
          : "border-border/80 bg-background text-muted-foreground hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-500",
        className,
      )}
    >
      <HeartIcon className={cn("size-4 transition-transform", active && "fill-current scale-110")} />
    </button>
  );
}
