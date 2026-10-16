"use client";

import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GaugeIcon,
  PaintbrushIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TagsIcon,
  UsersIcon,
  ImagesIcon,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import type { CurrentUser } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

export const ADMIN_NAV = [
  { href: "/nemesis", label: "Dashboard", icon: GaugeIcon, exact: true },
  { href: "/nemesis/pages", label: "Pages", icon: FileTextIcon },
  { href: "/nemesis/products", label: "Products", icon: PackageIcon },
  { href: "/nemesis/categories", label: "Categories", icon: TagsIcon },
  { href: "/nemesis/orders", label: "Orders", icon: ShoppingCartIcon },
  { href: "/nemesis/users", label: "Users", icon: UsersIcon },
  { href: "/nemesis/media", label: "Media", icon: ImagesIcon },
  // Extra (the UI page: Menu · Home page · Extra) – the navigation entry opens its own tab
  { href: "/nemesis/ui?tab=extra", label: "Extra", icon: PaintbrushIcon },
  { href: "/nemesis/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminSidebar({ user, storeName }: { user: CurrentUser; storeName: string }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, startTransition] = useTransition();
  const initial = (user.name || user.email || "A").trim().slice(0, 1).toUpperCase();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" href="/nemesis" tooltip={storeName}>
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShoppingBagIcon className="size-4" />
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{storeName}</span>
                <span className="truncate text-xs text-muted-foreground">Admin dashboard</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_NAV.map(({ href, label, icon: Icon, exact }) => {
                // Hrefs carrying a query (?tab=extra) still highlight their own section
                const path = href.split("?")[0];
                const active = exact ? pathname === path : pathname.startsWith(path);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton href={href} isActive={active} tooltip={label} aria-current={active ? "page" : undefined} onPress={() => isMobile && setOpenMobile(false)}>
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenuTrigger>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" aria-label="Account menu">
                <Avatar className="rounded-lg">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
                  <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
                </Avatar>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name || "Admin"}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </SidebarMenuButton>
              <DropdownMenu placement={isMobile ? "bottom end" : "right bottom"} className="min-w-56">
                <DropdownMenuItem href="/" target="_blank">
                  <ExternalLinkIcon /> View store
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onAction={() => startTransition(() => signOut())} isDisabled={signingOut}>
                  <LogOutIcon /> Sign out
                </DropdownMenuItem>
              </DropdownMenu>
            </DropdownMenuTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
