import Link from "next/link";
import { Suspense } from "react";
import { getSiteSettings } from "@/lib/site-settings";
import { getMenuCategories } from "@/lib/menu";
import { CartBadge } from "./cart-badge";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, UserMenuSkeleton } from "./user-menu";
import { BagIcon } from "./icons";

export async function Header() {
  const [{ store_name }, menuCategories] = await Promise.all([getSiteSettings(), getMenuCategories()]);
  // "Shop" is always there; the rest is whatever admins flagged as "Show in header menu".
  const nav = [
    { href: "/shop", label: "Shop" },
    ...menuCategories.map((c) => ({ href: `/shop?category=${c.slug}`, label: c.name })),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-surface/90 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-neutral-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <BagIcon className="h-4 w-4" />
          </span>
          {store_name}
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* Reads the auth cookie → streams in behind Suspense */}
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
          <ThemeToggle />
          <CartBadge />
        </div>
      </div>
    </header>
  );
}
