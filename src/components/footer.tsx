import Link from "next/link";
import { STORE_NAME } from "@/lib/config";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-neutral-200 bg-white">
      <div className="container-page flex flex-col items-center justify-between gap-4 py-8 text-sm text-neutral-500 sm:flex-row">
        <p>
          © {STORE_NAME}. Built with Next.js &amp; Supabase.
        </p>
        <nav className="flex gap-6">
          <Link href="/shop" className="hover:text-neutral-900">Shop</Link>
          <Link href="/cart" className="hover:text-neutral-900">Cart</Link>
          <Link href="/orders" className="hover:text-neutral-900">My orders</Link>
        </nav>
      </div>
    </footer>
  );
}
