import Link from "next/link";
import { Suspense } from "react";
import { ShoppingBag } from "lucide-react";
import { getSiteSettings } from "@/lib/site-settings";
import { getMenuCategories } from "@/lib/menu";
import { buttonVariants } from "@/components/ui/button-variants";
import { CartBadge } from "./cart-badge";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, UserMenuSkeleton } from "./user-menu";

export async function Header() {
  const [{ store_name }, menuCategories] = await Promise.all([getSiteSettings(), getMenuCategories()]);
  // "Shop" is always there; the rest is whatever admins flagged as "Show in header menu".
  const nav = [
    { href: "/shop", label: "Shop" },
    ...menuCategories.map((c) => ({ href: `/shop?category=${c.slug}`, label: c.name })),
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container-page flex h-16 items-center gap-2 sm:gap-4">
        <MobileNav items={nav} storeName={store_name} />

        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ShoppingBag className="size-4" aria-hidden />
          </span>
          <span className="truncate">{store_name}</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
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
