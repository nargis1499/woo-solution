"use client";

import { useTransition } from "react";
import { BellIcon, ChevronDownIcon, LogOutIcon, PackageIcon, ShieldCheckIcon, UserIcon } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import type { CurrentUser } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Signed-in header control: avatar + dropdown with orders, admin (if allowed) and sign-out. */
export function AccountMenu({ user, isAdmin }: { user: CurrentUser; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const firstName = user.name?.split(" ")[0] || user.email || "Account";
  const initial = (user.name || user.email || "?").trim().slice(0, 1).toUpperCase();

  return (
    <DropdownMenuTrigger>
      <Button variant="ghost" size="sm" className="gap-2 pl-1.5" aria-label="Account menu" isPending={pending}>
        <Avatar size="sm">
          {/* Google avatars go through plain <img>: tiny files, and the CDN rate-limits image proxies */}
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate sm:inline">{firstName}</span>
        <ChevronDownIcon className="hidden text-muted-foreground sm:block" />
      </Button>
      <DropdownMenu placement="bottom end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user.name || "Signed in"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem href="/orders">
          <PackageIcon /> My orders
        </DropdownMenuItem>
        <DropdownMenuItem href="/checkout">
          <UserIcon /> Checkout
        </DropdownMenuItem>
        <DropdownMenuItem href="/notifications">
          <BellIcon /> Notifications
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem href="/nemesis">
            <ShieldCheckIcon /> Admin dashboard
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onAction={() => startTransition(() => signOut())}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}
