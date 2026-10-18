"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type WishlistItem = {
  productId: string;
  slug: string;
  name: string;
  brand?: string | null;
  categoryName?: string | null;
  priceMicros: number;
  compareAtPriceMicros?: number | null;
  imageUrl: string | null;
  stock: number | null;
};

type WishlistState = {
  items: WishlistItem[];
  toggleItem: (item: WishlistItem) => boolean;
  removeItem: (productId: string) => void;
  clear: () => void;
};

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      toggleItem: (item) => {
        const exists = get().items.some((i) => i.productId === item.productId);
        if (exists) {
          set((state) => ({
            items: state.items.filter((i) => i.productId !== item.productId),
          }));
          return false;
        }
        set((state) => ({
          items: [item, ...state.items.filter((i) => i.productId !== item.productId)],
        }));
        return true;
      },
      removeItem: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.productId !== productId),
        })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "woo-solution-wishlist",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

export const selectWishlistCount = (s: WishlistState) => s.items.length;
export const selectIsWishlisted = (productId: string) => (s: WishlistState) =>
  s.items.some((i) => i.productId === productId);
