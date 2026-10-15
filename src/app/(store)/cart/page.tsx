import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";
import { CartView } from "@/components/cart-view";

export const metadata: Metadata = { title: "Cart", robots: NOINDEX };

export default function CartPage() {
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Your cart</h1>
      <CartView />
    </div>
  );
}
