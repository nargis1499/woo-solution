"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ShoppingCartIcon, ZapIcon } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import type { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Props = {
  product: Pick<Product, "id" | "slug" | "name" | "price_cents" | "image_url" | "stock">;
  quantity?: number;
  size?: "sm" | "default" | "lg";
  className?: string;
  /** "add" keeps the user on the page, "buy" jumps straight to checkout */
  mode?: "add" | "buy";
  /**
   * Settings → WooCommerce → stock management. Passed down from the page's
   * dynamic data (never from a layout/context) so a toggle in the dashboard is
   * picked up on the very next navigation – no full reload needed.
   */
  manageStock?: boolean;
};

export function AddToCartButton({ product, quantity = 1, size = "default", className, mode = "add", manageStock = true }: Props) {
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);
  const router = useRouter();
  const outOfStock = manageStock && product.stock <= 0;

  function handlePress() {
    addItem(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        priceCents: product.price_cents,
        imageUrl: product.image_url,
        stock: manageStock ? product.stock : null,
      },
      quantity,
    );
    if (mode === "buy") {
      router.push("/checkout");
      return;
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  if (outOfStock) {
    return (
      <Button variant="outline" size={size} className={className} isDisabled>
        Out of stock
      </Button>
    );
  }

  return (
    <Button variant={mode === "buy" ? "secondary" : "default"} size={size} className={className} onPress={handlePress} aria-live="polite">
      {added ? (
        <>
          <CheckIcon /> Added
        </>
      ) : mode === "buy" ? (
        <>
          <ZapIcon /> Buy now
        </>
      ) : (
        <>
          <ShoppingCartIcon /> Add to cart
        </>
      )}
    </Button>
  );
}
