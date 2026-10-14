"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BagIcon, BoxIcon, GaugeIcon, SettingsIcon, TagIcon, UsersIcon } from "@/components/icons";

const NAV = [
  { href: "/nemesis", label: "Dashboard", icon: GaugeIcon, exact: true },
  { href: "/nemesis/products", label: "Products", icon: BoxIcon },
  { href: "/nemesis/categories", label: "Categories", icon: TagIcon },
  { href: "/nemesis/orders", label: "Orders", icon: BagIcon },
  { href: "/nemesis/users", label: "Users", icon: UsersIcon },
  { href: "/nemesis/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminSidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="card p-3">
        <div className="mb-3 hidden items-center gap-3 px-2 py-1 lg:flex">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            {(user.name ?? user.email ?? "A").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name || "Admin"}</p>
            <p className="truncate text-xs text-neutral-500">{user.email}</p>
          </div>
        </div>

        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto lg:flex-col">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
