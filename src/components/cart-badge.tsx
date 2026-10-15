"use client";

import { ShoppingCartIcon } from "lucide-react";
import { Link } from "react-aria-components";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { selectCartCount, useCartStore, useHydrated } from "@/lib/cart-store";
import { cn } from "@/lib/utils";

export function CartBadge() {
  const hydrated = useHydrated();
  const count = useCartStore(selectCartCount);
  const shown = hydrated ? count : 0;

  return (
    <Link
      href="/cart"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
      aria-label={`Cart, ${shown} item${shown === 1 ? "" : "s"}`}
    >
      <ShoppingCartIcon className="size-5" />
      {shown > 0 && (
        <Badge className="absolute -top-1 -right-1 h-5 min-w-5 justify-center rounded-full px-1 text-[11px] tabular-nums">
          {shown > 99 ? "99+" : shown}
        </Badge>
      )}
    </Link>
  );
}
