"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ShoppingBagIcon, ShoppingCartIcon, ZapIcon } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import type { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Props = {
  product: Pick<Product, "id" | "slug" | "name" | "price_micros" | "image_url" | "stock">;
  /**
   * The chosen combination of a variable product: its own price / stock / image replace the
   * product's, and the cart keeps it as a separate line.
   */
  variation?: { id: string; label: string; price_micros: number; stock: number; image_url: string | null } | null;
  quantity?: number;
  size?: "sm" | "default" | "lg";
  className?: string;
  /** "add" keeps the user on the page, "buy" jumps straight to checkout */
  mode?: "add" | "buy";
  /** Optional custom button text (e.g. "Add" on product grid cards) */
  label?: string;
  /** Icon to render before the label */
  icon?: "cart" | "bag";
  /**
   * Settings → WooCommerce → stock management. Passed down from the page's
   * dynamic data (never from a layout/context) so a toggle in the dashboard is
   * picked up on the very next navigation – no full reload needed.
   */
  manageStock?: boolean;
};

export function AddToCartButton({
  product,
  variation = null,
  quantity = 1,
  size = "default",
  className,
  mode = "add",
  label,
  icon = "cart",
  manageStock = true,
}: Props) {
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);
  const router = useRouter();
  const stock = variation ? variation.stock : product.stock;
  const outOfStock = manageStock && stock <= 0;

  function handlePress() {
    addItem(
      {
        productId: product.id,
        variationId: variation?.id ?? null,
        variationLabel: variation?.label ?? null,
        slug: product.slug,
        name: product.name,
        priceMicros: variation ? variation.price_micros : product.price_micros,
        imageUrl: variation?.image_url ?? product.image_url,
        stock: manageStock ? stock : null,
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

  const Icon = icon === "bag" ? ShoppingBagIcon : ShoppingCartIcon;

  return (
    <Button
      variant={mode === "buy" ? "secondary" : "default"}
      size={size}
      className={className}
      onPress={handlePress}
      aria-live="polite"
      data-testid="add-to-cart-button"
    >
      {added ? (
        <>
          <CheckIcon className="size-3.5" /> Added
        </>
      ) : mode === "buy" ? (
        <>
          <ZapIcon className="size-3.5" /> {label ?? "Buy now"}
        </>
      ) : (
        <>
          <Icon className="size-3.5" /> {label ?? "Add to cart"}
        </>
      )}
    </Button>
  );
}
