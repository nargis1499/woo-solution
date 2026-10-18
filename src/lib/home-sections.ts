import type { SiteSettings } from "@/lib/types";

/*
 * Home page sections (UI → Home page). Shared by the admin form, its Server
 * Action and the storefront so the ids, labels and limits live in one place.
 */

/** Longest heading the filtered-products section accepts. */
export const HOME_FILTER_TITLE_MAX = 80;

/** Field limits & defaults for the dynamic Home page Hero section. */
export const HOME_HERO_BADGE_MAX = 40;
export const HOME_HERO_TITLE_MAX = 140;
export const HOME_HERO_SUBTITLE_MAX = 280;
export const HOME_HERO_CTA_TEXT_MAX = 40;
export const HOME_HERO_CTA_HREF_MAX = 200;

export const DEFAULT_HOME_HERO_BADGE = "New season";
export const DEFAULT_HOME_HERO_PRIMARY_CTA_TEXT = "Shop now";
export const DEFAULT_HOME_HERO_PRIMARY_CTA_HREF = "/shop";
export const DEFAULT_HOME_HERO_SECONDARY_CTA_TEXT = "Explore electronics";
export const DEFAULT_HOME_HERO_SECONDARY_CTA_HREF = "/shop?category=electronics";

export function defaultHomeHeroTitle(storeName: string): string {
  return `Everything you love about ${storeName}, now faster.`;
}

export function defaultHomeHeroSubtitle(freeShippingFormatted: string): string {
  return `Browse the catalog, add to your cart and check out in seconds. Free shipping on orders over ${freeShippingFormatted}.`;
}

export type HomeSectionId =
  | "home_show_hero"
  | "home_show_categories"
  | "home_show_featured"
  | "home_show_filter";

export const HOME_SECTIONS: readonly { id: HomeSectionId; label: string; description: string }[] = [
  { id: "home_show_hero", label: "Hero section", description: "Main promotional banner at the top of the home page." },
  { id: "home_show_categories", label: "Shop by category", description: "A tile for every category, linking into the shop." },
  { id: "home_show_featured", label: "Featured products", description: "Up to eight products marked as featured (hidden when none are featured)." },
  { id: "home_show_filter", label: "Filtered products", description: "The shop's category filter with the matching products, right on the home page." },
];

/** Placeholder of the heading input in the admin form. */
export const HOME_FILTER_TITLE_PLACEHOLDER = "Enter the filter product title";

/** The home page sections an admin can switch, in storefront order. */
export function homeSectionsOf(settings: SiteSettings): Record<HomeSectionId, boolean> {
  return {
    home_show_hero: settings.home_show_hero,
    home_show_categories: settings.home_show_categories,
    home_show_featured: settings.home_show_featured,
    home_show_filter: settings.home_show_filter,
  };
}
