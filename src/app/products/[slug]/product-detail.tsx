"use client";

import { useState } from "react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { QuantityInput } from "@/components/quantity-input";
import type { Product } from "@/lib/types";

/** Client island: quantity picker + add-to-cart / buy-now buttons. */
export function ProductPurchasePanel({ product }: { product: Product }) {
  const [qty, setQty] = useState(1);
  const inStock = product.stock > 0;

  return (
    <div className="space-y-4">
      <p className={inStock ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-red-600"}>
        {inStock ? (product.stock <= 5 ? `Only ${product.stock} left in stock` : "In stock") : "Out of stock"}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {inStock && <QuantityInput value={qty} onChange={setQty} max={product.stock} />}
        <AddToCartButton product={product} quantity={qty} size="lg" className="min-w-40" />
        {inStock && <AddToCartButton product={product} quantity={qty} size="lg" mode="buy" className="min-w-32" />}
      </div>
    </div>
  );
}
