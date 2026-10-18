import type {
  Category,
  HomeCategoryBannerStyle,
  HomeCategoryDisplayMode,
  HomeCategorySectionConfig,
  SiteSettings,
} from "@/lib/types";

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

export const HOME_CATEGORY_BANNER_STYLES: readonly {
  id: HomeCategoryBannerStyle;
  label: string;
}[] = [
  { id: "soft", label: "Soft Primary Tint" },
  { id: "dark-gradient", label: "Dark Gradient Banner" },
  { id: "primary-gradient", label: "Theme Primary Gradient" },
  { id: "glass", label: "Frosted Glass Card" },
  { id: "minimal", label: "Minimal Accent Line" },
];

export const HOME_CATEGORY_LIMIT_OPTIONS: readonly {
  value: number;
  label: string;
}[] = [
  { value: 3, label: "3 Products" },
  { value: 6, label: "6 Products" },
  { value: 9, label: "9 Products" },
  { value: 12, label: "12 Products" },
  { value: 0, label: "All Products" },
];

export function isHomeCategoryDisplayMode(v: unknown): v is HomeCategoryDisplayMode {
  return v === "grid" || v === "list";
}

export function isHomeCategoryBannerStyle(v: unknown): v is HomeCategoryBannerStyle {
  return HOME_CATEGORY_BANNER_STYLES.some((s) => s.id === v);
}

export function normaliseHomeCategorySections(
  raw: unknown,
  defaultBannerStyle: HomeCategoryBannerStyle = "soft",
): HomeCategorySectionConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HomeCategorySectionConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const categoryId = typeof rec.category_id === "string" ? rec.category_id.trim() : "";
    if (!categoryId || seen.has(categoryId)) continue;
    seen.add(categoryId);
    const enabled = typeof rec.enabled === "boolean" ? rec.enabled : true;
    const rawLimit = Number(rec.limit);
    const limit =
      Number.isInteger(rawLimit) && [0, 3, 6, 9, 12].includes(rawLimit) ? rawLimit : 6;
    const layout: HomeCategoryDisplayMode = isHomeCategoryDisplayMode(rec.layout)
      ? rec.layout
      : "grid";
    const banner_style: HomeCategoryBannerStyle = isHomeCategoryBannerStyle(rec.banner_style)
      ? rec.banner_style
      : defaultBannerStyle;
    out.push({ category_id: categoryId, enabled, limit, layout, banner_style });
  }
  return out;
}

/**
 * Resolves the ordered list of category section configurations against the live categories.
 * - Categories saved in `saved` keep their exact custom order, visibility, item limit, layout,
 *   and banner style (completely independent of the Categories page `sort_order`).
 * - Any newly created category not yet in `saved` is appended with defaults.
 */
export function resolveHomeCategorySections(
  categories: Category[],
  saved: HomeCategorySectionConfig[],
  defaultLayout: HomeCategoryDisplayMode = "grid",
  defaultBannerStyle: HomeCategoryBannerStyle = "soft",
): Array<HomeCategorySectionConfig & { category: Category }> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const resolved: Array<HomeCategorySectionConfig & { category: Category }> = [];

  for (const cfg of saved) {
    const category = byId.get(cfg.category_id);
    if (!category || seen.has(category.id)) continue;
    seen.add(category.id);
    resolved.push({
      ...cfg,
      banner_style: isHomeCategoryBannerStyle(cfg.banner_style)
        ? cfg.banner_style
        : defaultBannerStyle,
      category,
    });
  }

  for (const category of categories) {
    if (seen.has(category.id)) continue;
    seen.add(category.id);
    resolved.push({
      category_id: category.id,
      enabled: true,
      limit: 6,
      layout: defaultLayout,
      banner_style: defaultBannerStyle,
      category,
    });
  }

  return resolved;
}

/** Parses comma-separated product features (up to `max` items). */
export function parseProductFeatures(features: string | null | undefined, max = 3): string[] {
  if (!features) return [];
  return features
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

export type HomeSectionId =
  | "home_show_hero"
  | "home_show_categories"
  | "home_show_category_sections"
  | "home_show_featured"
  | "home_show_filter";

export const HOME_SECTIONS: readonly { id: HomeSectionId; label: string; description: string }[] = [
  { id: "home_show_hero", label: "Hero section", description: "Main promotional banner at the top of the home page." },
  { id: "home_show_categories", label: "Shop by category", description: "A tile for every category, linking into the shop." },
  { id: "home_show_category_sections", label: "Category Product Showcase Section", description: "Enable or disable homepage category blocks and choose default layout preferences." },
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
    home_show_category_sections: settings.home_show_category_sections,
    home_show_featured: settings.home_show_featured,
    home_show_filter: settings.home_show_filter,
  };
}
