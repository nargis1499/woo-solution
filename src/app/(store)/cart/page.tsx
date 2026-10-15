import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { NOINDEX } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { CartView } from "@/components/cart-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Cart", robots: NOINDEX };

export default function CartPage() {
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Your cart</h1>
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" aria-busy />}>
        <Cart />
      </Suspense>
    </div>
  );
}

/** Rendered per request (not in the static shell) so the stock switch from Settings → WooCommerce is always current. */
async function Cart() {
  await connection();
  const { manage_stock } = await getSiteSettings();
  return <CartView manageStock={manage_stock} />;
}
