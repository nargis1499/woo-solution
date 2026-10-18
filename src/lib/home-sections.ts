import type { SiteSettings } from "@/lib/types";

/*
 * Home page sections (UI → Home page). Shared by the admin form, its Server
 * Action and the storefront so the ids, labels and limits live in one place.
 */

/** Longest heading the filtered-products section accepts. */
export const HOME_FILTER_TITLE_MAX = 80;

export type HomeSectionId = "home_show_categories" | "home_show_featured" | "home_show_filter";

export const HOME_SECTIONS: readonly { id: HomeSectionId; label: string; description: string }[] = [
  { id: "home_show_categories", label: "Shop by category", description: "A tile for every category, linking into the shop." },
  { id: "home_show_featured", label: "Featured products", description: "Up to eight products marked as featured (hidden when none are featured)." },
  { id: "home_show_filter", label: "Filtered products", description: "The shop's category filter with the matching products, right on the home page." },
];

/** Placeholder of the heading input in the admin form. */
export const HOME_FILTER_TITLE_PLACEHOLDER = "Enter the filter product title";

/** The home page sections an admin can switch, in storefront order. */
export function homeSectionsOf(settings: SiteSettings): Record<HomeSectionId, boolean> {
  return {
    home_show_categories: settings.home_show_categories,
    home_show_featured: settings.home_show_featured,
    home_show_filter: settings.home_show_filter,
  };
}
