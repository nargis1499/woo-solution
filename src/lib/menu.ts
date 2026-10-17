import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isExternalHref, menuItemHref } from "@/lib/menu-config";
import type { MenuItemKind, MenuLocation, PageStatus } from "@/lib/types";

/** Invalidated by every menu, page and category write in the dashboard. */
export const MENU_TAG = "menus";

export type MenuLink = {
  id: string;
  label: string;
  href: string;
  /** Rendered with `target="_blank"`. */
  newTab: boolean;
  /** Absolute `http(s)` URL – rendered as a plain anchor instead of a Next.js link. */
  external: boolean;
};

type Row = {
  id: string;
  kind: MenuItemKind;
  title: string;
  url: string | null;
  open_in_new_tab: boolean;
  page: { slug: string; status: PageStatus } | null;
  category: { slug: string } | null;
};

/**
 * Navigation links for a storefront location, in the order set under UI → Menu.
 *
 * Cached and tagged like the site settings, so the header and footer stay part of the
 * static shell; the dashboard calls `updateTag(MENU_TAG)` after every menu / page /
 * category write and the storefront refreshes immediately. Page items are only shown
 * while their page is published (an anonymous read never sees drafts, so they come back
 * without a page and are skipped). Falls back to an empty list if the table can't be
 * reached, so a storefront never breaks because of its navigation.
 */
export const getMenu = cache(async (location: MenuLocation): Promise<MenuLink[]> => {
  return unstable_cache(
    async (): Promise<MenuLink[]> => {
      try {
        const supabase = createPublicClient();
        const { data, error } = await supabase
          .from("menu_items")
          .select("id, kind, title, url, open_in_new_tab, page:pages(slug, status), category:categories(slug)")
          .eq("location", location)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(50);

        if (error) {
          return [];
        }
        return ((data ?? []) as unknown as Row[]).flatMap((item) => {
          if (item.kind === "page" && item.page?.status !== "published") return [];
          const href = menuItemHref(item);
          if (!href) return [];
          return [{ id: item.id, label: item.title, href, newTab: item.open_in_new_tab, external: isExternalHref(href) }];
        });
      } catch {
        return [];
      }
    },
    ["menu", location],
    { tags: [MENU_TAG], revalidate: 3600 },
  )();
});
