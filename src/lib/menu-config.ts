import type { MenuItem, MenuLocation } from "@/lib/types";

/** Shared between the storefront, the admin UI and the Server Actions (no server-only imports here). */

export const MENU_LOCATIONS = [
  { id: "header", label: "Header menu", hint: "The main navigation at the top of every storefront page." },
  { id: "footer", label: "Footer menu", hint: "The links in the footer of every storefront page." },
] as const satisfies readonly { id: MenuLocation; label: string; hint: string }[];

export function isMenuLocation(value: unknown): value is MenuLocation {
  return MENU_LOCATIONS.some((l) => l.id === value);
}

export const menuLocationLabel = (location: MenuLocation) => MENU_LOCATIONS.find((l) => l.id === location)?.label ?? "Menu";

/** Admin URL of a menu: `/nemesis/ui` is the header, the footer is `?location=footer`. */
export const menuPath = (location: MenuLocation) => (location === "header" ? "/nemesis/ui" : `/nemesis/ui?location=${location}`);

export const MENU_KIND_LABELS = { page: "Page", category: "Category", custom: "Custom link" } as const;

/** Upper bounds shared by the form, the action and the DB check constraints. */
export const MENU_TITLE_MAX = 80;
export const MENU_URL_MAX = 500;
export const MENU_ITEMS_MAX = 50;

/** Where an item points – `null` when its page / category no longer exists (the row is skipped). */
export function menuItemHref(item: Pick<MenuItem, "kind" | "url"> & { page?: { slug: string } | null; category?: { slug: string } | null }): string | null {
  if (item.kind === "page") return item.page?.slug ? `/${item.page.slug}` : null;
  if (item.kind === "category") return item.category?.slug ? `/shop?category=${encodeURIComponent(item.category.slug)}` : null;
  return item.url || null;
}

export const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

/**
 * Custom-link URLs: a path on this site (`/about`, `/shop?category=sale`, `#top`), a full
 * `http(s)://` address, `mailto:` or `tel:`. Everything else (`javascript:`, `data:`, bare
 * `example.com`, protocol-relative `//…`) is rejected rather than guessed.
 */
export function normalizeMenuUrl(raw: string): { url: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Enter a URL." };
  if (value.length > MENU_URL_MAX) return { error: `Keep the URL under ${MENU_URL_MAX} characters.` };
  if (/[\s<>"]/.test(value)) return { error: "The URL contains characters that are not allowed." };
  if (value.startsWith("//")) return { error: "Protocol-relative URLs are not supported – start with https://." };
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("?")) return { url: value };
  if (/^(mailto|tel):.+/i.test(value)) return { url: value };
  if (/^https?:\/\//i.test(value)) {
    try {
      new URL(value);
      return { url: value };
    } catch {
      return { error: "That doesn't look like a valid web address." };
    }
  }
  return { error: "Use a full address (https://example.com) or a path on this site (/about)." };
}
