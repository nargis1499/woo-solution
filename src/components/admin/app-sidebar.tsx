"use client";

import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  BellIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GaugeIcon,
  LayoutTemplateIcon,
  LogOutIcon,
  NewspaperIcon,
  PackageIcon,
  SettingsIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  StoreIcon,
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
  { href: "/nemesis/posts", label: "Blog posts", icon: NewspaperIcon },
  { href: "/nemesis/products", label: "Products", icon: PackageIcon },
  { href: "/nemesis/categories", label: "Categories", icon: TagsIcon },
  { href: "/nemesis/orders", label: "Orders", icon: ShoppingCartIcon },
  { href: "/nemesis/notifications", label: "Notifications", icon: BellIcon },
  { href: "/nemesis/users", label: "Users", icon: UsersIcon },
  { href: "/nemesis/media", label: "Media", icon: ImagesIcon },
  // The UI page (tabs: Menu · Home page · Extra). Plain href: the sidebar entry always opens
  // the page on its first tab and stays highlighted on the others – deep links (?tab=extra) are
  // for the tab strip itself, not the sidebar.
  { href: "/nemesis/ui", label: "UI", icon: LayoutTemplateIcon },
  { href: "/nemesis/ecommerce", label: "E-commerce", icon: StoreIcon },
  { href: "/nemesis/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminSidebar({ user, storeName }: { user: CurrentUser; storeName: string }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, startTransition] = useTransition();
  const initial = (user.name || user.email || "A").trim().slice(0, 1).toUpperCase();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="px-4 py-2 group-data-[collapsible=icon]:p-2">
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
        <SidebarGroup className="px-0 py-2 group-data-[collapsible=icon]:p-2">
          <SidebarGroupLabel className="px-4">Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:gap-1">
              {ADMIN_NAV.map(({ href, label, icon: Icon, exact }) => {
                // Every tab of a section (?tab=extra, ?location=footer) highlights the same entry.
                const path = href.split("?")[0];
                const active = exact ? pathname === path : pathname.startsWith(path);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      href={href}
                      isActive={active}
                      tooltip={label}
                      aria-current={active ? "page" : undefined}
                      onPress={() => isMobile && setOpenMobile(false)}
                      className="h-auto rounded-none px-4 py-2.5 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:rounded-md"
                    >
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

      <SidebarFooter className="px-4 py-2 group-data-[collapsible=icon]:p-2">
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
