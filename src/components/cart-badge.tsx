"use client";

import Link from "next/link";
import { selectCartCount, useCartStore, useHydrated } from "@/lib/cart-store";
import { CartIcon } from "./icons";

export function CartBadge() {
  const hydrated = useHydrated();
  const count = useCartStore(selectCartCount);
  const shown = hydrated ? count : 0;

  return (
    <Link
      href="/cart"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100"
      aria-label={`Cart, ${shown} item${shown === 1 ? "" : "s"}`}
    >
      <CartIcon className="h-5 w-5" />
      {shown > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
          {shown > 99 ? "99+" : shown}
        </span>
      )}
    </Link>
  );
}
