import Link from "next/link";
import { Suspense } from "react";
import { ShoppingBag } from "lucide-react";
import { getSiteSettings } from "@/lib/site-settings";
import { getMenu } from "@/lib/menu";
import { buttonVariants } from "@/components/ui/button-variants";
import { NotificationBellGate, NotificationBellSkeleton } from "@/components/notifications/notification-bell-gate";
import { CartBadge } from "./cart-badge";
import { PresenceGate } from "./presence-gate";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, UserMenuSkeleton } from "./user-menu";

export async function Header() {
  // The links are whatever admins put together under UI → Menu → Header menu.
  const [{ store_name }, nav] = await Promise.all([getSiteSettings(), getMenu("header")]);

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

        {nav.length > 0 && (
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.id} item={item} className={buttonVariants({ variant: "ghost", size: "sm" })} />
            ))}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Reads the auth cookie → streams in behind Suspense */}
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
          {/* presence heartbeat for signed-in visitors (same request-scoped user lookup) */}
          <Suspense fallback={null}>
            <PresenceGate />
          </Suspense>
          {/* the live bell – a server island: count on first paint, live after it (nothing for guests) */}
          <Suspense fallback={<NotificationBellSkeleton />}>
            <NotificationBellGate basePath="/notifications" />
          </Suspense>
          <ThemeToggle />
          <CartBadge />
        </div>
      </div>
    </header>
  );
}
