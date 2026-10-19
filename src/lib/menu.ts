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
  /** Optional parent item id (header menu only). */
  parentId?: string | null;
  /** Dropdown child links (header menu only). */
  children?: MenuLink[];
};

type Row = {
  id: string;
  kind: MenuItemKind;
  title: string;
  url: string | null;
  open_in_new_tab: boolean;
  parent_id?: string | null;
  page: { slug: string; status: PageStatus } | null;
  category: { slug: string } | null;
};

/**
 * Navigation links for a storefront location, in the order set under UI → Menu.
 *
 * For `header`, items with `parent_id` are grouped under their top-level parent item's
 * `children` array to render a dropdown menu. For `footer`, items are always flat.
 */
export const getMenu = cache(async (location: MenuLocation): Promise<MenuLink[]> => {
  return unstable_cache(
    async (): Promise<MenuLink[]> => {
      try {
        const supabase = createPublicClient();
        const primaryRes = await supabase
          .from("menu_items")
          .select("id, kind, title, url, open_in_new_tab, parent_id, page:pages(slug, status), category:categories(slug)")
          .eq("location", location)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(50);

        let data: unknown[] | null = primaryRes.data;
        let error = primaryRes.error;
        let usedLegacy = false;
        if (error && /parent_id/i.test(`${error.message} ${error.code}`)) {
          usedLegacy = true;
          const legacyRes = await supabase
            .from("menu_items")
            .select("id, kind, title, url, open_in_new_tab, page:pages(slug, status), category:categories(slug)")
            .eq("location", location)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
            .limit(50);
          data = legacyRes.data;
          error = legacyRes.error;
        }

        if (error) {
          return [];
        }

        let fallbackParentMap: Record<string, string | null> = {};
        if (usedLegacy && location === "header") {
          const { data: settingsRow } = await supabase
            .from("site_settings")
            .select("theme_gradients")
            .eq("id", 1)
            .maybeSingle();
          const meta =
            settingsRow?.theme_gradients && typeof settingsRow.theme_gradients === "object"
              ? (settingsRow.theme_gradients as Record<string, unknown>)
              : {};
          if (meta.menu_parent_map && typeof meta.menu_parent_map === "object") {
            fallbackParentMap = meta.menu_parent_map as Record<string, string | null>;
          }
        }

        const resolved: Array<MenuLink & { rawParentId: string | null }> = (
          (data ?? []) as unknown as Row[]
        ).flatMap((item) => {
          if (item.kind === "page" && item.page?.status !== "published") return [];
          const href = menuItemHref(item);
          if (!href) return [];
          const rawParentId =
            location === "header"
              ? (usedLegacy ? fallbackParentMap[item.id] : item.parent_id) ?? null
              : null;
          return [
            {
              id: item.id,
              label: item.title,
              href,
              newTab: item.open_in_new_tab,
              external: isExternalHref(href),
              parentId: rawParentId,
              rawParentId,
            },
          ];
        });

        if (location !== "header") {
          return resolved.map(({ id, label, href, newTab, external }) => ({
            id,
            label,
            href,
            newTab,
            external,
          }));
        }

        // Build 2-level hierarchy for Header menu:
        // A valid parent must exist in `resolved` and itself be a top-level item.
        const byId = new Map(resolved.map((item) => [item.id, item]));
        const topLevelIds = new Set<string>();
        for (const item of resolved) {
          const parent = item.rawParentId ? byId.get(item.rawParentId) : undefined;
          if (!parent || parent.id === item.id || parent.rawParentId) {
            topLevelIds.add(item.id);
          }
        }

        const topLevelMap = new Map<string, MenuLink>();
        const topLevelList: MenuLink[] = [];

        for (const item of resolved) {
          if (topLevelIds.has(item.id)) {
            const node: MenuLink = {
              id: item.id,
              label: item.label,
              href: item.href,
              newTab: item.newTab,
              external: item.external,
              parentId: null,
              children: [],
            };
            topLevelMap.set(item.id, node);
            topLevelList.push(node);
          }
        }

        for (const item of resolved) {
          if (!topLevelIds.has(item.id) && item.rawParentId) {
            const parentNode = topLevelMap.get(item.rawParentId);
            if (parentNode) {
              parentNode.children = parentNode.children ?? [];
              parentNode.children.push({
                id: item.id,
                label: item.label,
                href: item.href,
                newTab: item.newTab,
                external: item.external,
                parentId: parentNode.id,
              });
            }
          }
        }

        return topLevelList;
      } catch {
        return [];
      }
    },
    ["menu", location],
    { tags: [MENU_TAG], revalidate: 3600 },
  )();
});
