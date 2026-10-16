"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useSyncExternalStore } from "react";
import { MAX_QTY_PER_LINE } from "./config";

export type CartItem = {
  productId: string;
  /** Which variation was chosen (variable products); null for simple products. */
  variationId?: string | null;
  /** Display text of that variation, e.g. "Red / Small". */
  variationLabel?: string | null;
  slug: string;
  name: string;
  /** Unit price in USD micros – the variation's own price for a variable product. */
  priceMicros: number;
  imageUrl: string | null;
  /** Units available when stock is managed; null = unlimited (Settings → WooCommerce → stock management off) */
  stock: number | null;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  setQuantity: (lineKey: string, quantity: number) => void;
  removeItem: (lineKey: string) => void;
  clear: () => void;
};

/**
 * A cart line is one product **and** one variation: Red / Small and Red / Medium are two
 * different lines, so prices, stock and the order items stay apart.
 */
export function lineKey(item: Pick<CartItem, "productId" | "variationId">): string {
  return item.variationId ? `${item.productId}:${item.variationId}` : item.productId;
}

function clampQty(qty: number, stock: number | null) {
  const available = stock == null ? MAX_QTY_PER_LINE : Math.max(stock, 1);
  return Math.max(1, Math.min(qty, MAX_QTY_PER_LINE, available));
}

/**
 * Guest-friendly cart persisted in localStorage.
 * Prices here are only for display – the `place_order` RPC re-prices
 * everything from the database at checkout.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],

      addItem: (item, quantity = 1) =>
        set((state) => {
          const key = lineKey(item);
          const existing = state.items.find((i) => lineKey(i) === key);
          if (existing) {
            return {
              items: state.items.map((i) =>
                lineKey(i) === key ? { ...i, ...item, quantity: clampQty(i.quantity + quantity, item.stock) } : i,
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity: clampQty(quantity, item.stock) }] };
        }),

      setQuantity: (key, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => lineKey(i) !== key)
              : state.items.map((i) => (lineKey(i) === key ? { ...i, quantity: clampQty(quantity, i.stock) } : i)),
        })),

      removeItem: (key) => set((state) => ({ items: state.items.filter((i) => lineKey(i) !== key) })),

      clear: () => set({ items: [] }),
    }),
    {
      name: "woo-solution-cart",
      // v1 stored `priceCents`; v2 stores `priceMicros` (1 USD = 1,000,000) – a cart saved by
      // an older release is scaled up here instead of being read as a fraction of the price.
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
      migrate: (persisted) => {
        const old = persisted as { items?: (Omit<CartItem, "priceMicros"> & { priceMicros?: number; priceCents?: number })[] } | undefined;
        return {
          items: (old?.items ?? []).map((item) => ({ ...item, priceMicros: item.priceMicros ?? (item.priceCents ?? 0) * 10_000 })) as CartItem[],
        } as CartState;
      },
    },
  ),
);

export const selectCartCount = (state: CartState) =>
  state.items.reduce((n, i) => n + i.quantity, 0);

export const selectCartSubtotal = (state: CartState) =>
  state.items.reduce((n, i) => n + i.quantity * i.priceMicros, 0);

const noopSubscribe = () => () => {};

/**
 * `true` once the component is running in the browser. Use it to avoid
 * hydration mismatches when rendering localStorage-backed cart state.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
