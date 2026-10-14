"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/lib/cart-store";
import type { Product } from "@/lib/types";
import { Button } from "./ui/button";
import { CheckIcon } from "./icons";

type Props = {
  product: Pick<Product, "id" | "slug" | "name" | "price_cents" | "image_url" | "stock">;
  quantity?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** "add" keeps the user on the page, "buy" jumps straight to checkout */
  mode?: "add" | "buy";
};

export function AddToCartButton({ product, quantity = 1, size = "md", className, mode = "add" }: Props) {
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);
  const router = useRouter();
  const outOfStock = product.stock <= 0;

  function handleClick() {
    addItem(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        priceCents: product.price_cents,
        imageUrl: product.image_url,
        stock: product.stock,
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
      <Button variant="outline" size={size} className={className} disabled>
        Out of stock
      </Button>
    );
  }

  return (
    <Button
      variant={mode === "buy" ? "secondary" : "primary"}
      size={size}
      className={className}
      onClick={handleClick}
      aria-live="polite"
    >
      {added ? (
        <>
          <CheckIcon className="h-4 w-4" /> Added
        </>
      ) : mode === "buy" ? (
        "Buy now"
      ) : (
        "Add to cart"
      )}
    </Button>
  );
}
