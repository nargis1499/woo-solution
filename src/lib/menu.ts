import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { Category } from "@/lib/types";

export const MENU_TAG = "menu-categories";

export type MenuCategory = Pick<Category, "id" | "name" | "slug">;

/**
 * Categories that admins chose to show in the header navigation
 * (`categories.show_in_menu = true`), in sort order.
 *
 * Cached and tagged like the site settings, so the header stays part of the
 * static shell; saving / toggling / deleting a category in the dashboard calls
 * `updateTag(MENU_TAG)` and the menu refreshes immediately. Falls back to an
 * empty list (only "Shop" is shown) if the table can't be reached.
 */
export async function getMenuCategories(): Promise<MenuCategory[]> {
  "use cache";
  cacheTag(MENU_TAG);

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("show_in_menu", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(12);

    if (error) {
      cacheLife("seconds");
      return [];
    }
    cacheLife("days");
    return (data ?? []) as MenuCategory[];
  } catch {
    cacheLife("seconds");
    return [];
  }
}
