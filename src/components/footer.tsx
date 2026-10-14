import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings";

export async function Footer() {
  const { store_name, tagline, support_email } = await getSiteSettings();
  return (
    <footer className="mt-16 border-t border-neutral-200 bg-surface">
      <div className="container-page flex flex-col items-center justify-between gap-4 py-8 text-sm text-neutral-500 sm:flex-row">
        <p className="text-center sm:text-left">
          {tagline && <span className="mb-1 block font-medium text-neutral-700">{tagline}</span>}
          © {store_name}. Built with Next.js &amp; Supabase.
          {support_email && (
            <>
              {" "}· <a href={`mailto:${support_email}`} className="hover:text-neutral-900">{support_email}</a>
            </>
          )}
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
