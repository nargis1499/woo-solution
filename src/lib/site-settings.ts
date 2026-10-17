import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { STORE_NAME } from "@/lib/config";
import { isCurrencyCode, moneyFromSettings, type Money } from "@/lib/money";
import { DEFAULT_THEME, normaliseColors, normaliseGradients, templateTheme } from "@/lib/theme";
import type { SiteSettings } from "@/lib/types";

export const SITE_SETTINGS_TAG = "site-settings";

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  store_name: STORE_NAME,
  tagline: null,
  support_email: null,
  telegram: null,
  whatsapp: null,
  favicon_url: null,
  favicon_media_id: null,
  seo_indexing: true,
  seo_site_url: null,
  seo_title: null,
  seo_description: null,
  seo_og_image_url: null,
  seo_og_image_media_id: null,
  seo_google_verification: null,
  seo_bing_verification: null,
  seo_twitter: null,
  manage_stock: true,
  currency: "USD",
  usd_to_bdt_rate: null,
  home_show_categories: true,
  home_show_featured: true,
  home_show_filter: false,
  home_filter_title: null,
  theme_light: DEFAULT_THEME.light,
  theme_dark: DEFAULT_THEME.dark,
  // a fresh copy per read: the two modes must never share one gradient object
  theme_gradients: templateTheme().gradients,
  theme_sync: false,
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
// numeric columns arrive as strings through PostgREST
const positive = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Turns a raw `site_settings` row into a fully-populated object. Columns that
 * do not exist yet (migration not run) simply fall back to the defaults, so an
 * older database keeps working until `20261018000000_settings_tabs.sql` /
 * `20261024000000_home_sections.sql` / `20261025000000_currency.sql` are applied.
 */
export function normaliseSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) return DEFAULT_SITE_SETTINGS;
  return {
    store_name: text(row.store_name) ?? DEFAULT_SITE_SETTINGS.store_name,
    tagline: text(row.tagline),
    support_email: text(row.support_email),
    telegram: text(row.telegram),
    whatsapp: text(row.whatsapp),
    favicon_url: text(row.favicon_url),
    favicon_media_id: text(row.favicon_media_id),
    seo_indexing: flag(row.seo_indexing, true),
    seo_site_url: text(row.seo_site_url)?.replace(/\/+$/, "") ?? null,
    seo_title: text(row.seo_title),
    seo_description: text(row.seo_description),
    seo_og_image_url: text(row.seo_og_image_url),
    seo_og_image_media_id: text(row.seo_og_image_media_id),
    seo_google_verification: text(row.seo_google_verification),
    seo_bing_verification: text(row.seo_bing_verification),
    seo_twitter: text(row.seo_twitter),
    manage_stock: flag(row.manage_stock, true),
    currency: isCurrencyCode(row.currency) ? row.currency : "USD",
    usd_to_bdt_rate: positive(row.usd_to_bdt_rate),
    home_show_categories: flag(row.home_show_categories, true),
    home_show_featured: flag(row.home_show_featured, true),
    home_show_filter: flag(row.home_show_filter, false),
    home_filter_title: text(row.home_filter_title),
    // Extra → Theme Customization: unknown shapes fall back to the template palette
    theme_light: normaliseColors(row.theme_light),
    theme_dark: normaliseColors(row.theme_dark),
    theme_gradients: normaliseGradients(row.theme_gradients),
    theme_sync: flag(row.theme_sync, false),
  };
}

/**
 * Store name, contact links, SEO flags & the global stock switch as edited in
 * /nemesis/settings.
 *
 * Cached with `"use cache"` and tagged, so the header/footer/metadata stay part
 * of the static shell; saving a settings tab calls `updateTag()` which
 * refreshes it instantly. Falls back to the env defaults when the table is not
 * reachable (e.g. the migration hasn't been run yet) – with a short lifetime so
 * we retry soon.
 */
const getCachedSiteSettings = unstable_cache(
  async (): Promise<SiteSettings> => {
    try {
      const supabase = createPublicClient();
      // `*` instead of a column list: unknown columns would make the whole query
      // fail on a database that has not run the latest migration yet.
      const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();

      if (error || !data) {
        return DEFAULT_SITE_SETTINGS;
      }

      return normaliseSiteSettings(data as Record<string, unknown>);
    } catch {
      return DEFAULT_SITE_SETTINGS;
    }
  },
  ["site-settings"],
  { tags: [SITE_SETTINGS_TAG], revalidate: 3600 },
);

export async function getSiteSettings(): Promise<SiteSettings> {
  return getCachedSiteSettings();
}

/**
 * The same row, read on **every request** – the admin area uses this so a currency or
 * stock-management switch is visible the moment it is saved: `getSiteSettings()` is tagged
 * and its prerendered shells are refreshed in the background, which can serve the previous
 * revision for a few seconds (stale-while-revalidate). Admin pages are dynamic anyway.
 */
export async function getSiteSettingsFresh(): Promise<SiteSettings> {
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return DEFAULT_SITE_SETTINGS;
    return normaliseSiteSettings(data as Record<string, unknown>);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

/** The display currency + rate for server components (`<MoneyProvider>` covers the client side). */
export async function getMoney(): Promise<Money> {
  return moneyFromSettings(await getSiteSettings());
}

/**
 * Absolute origin of the storefront, used for canonical URLs, the sitemap and
 * JSON-LD. Admin-configured value first, then the usual deployment env vars.
 */
export function resolveSiteUrl(settings: Pick<SiteSettings, "seo_site_url">): string | null {
  const fromSettings = settings.seo_site_url;
  if (fromSettings) return fromSettings;
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : null;
}

/** `https://wa.me/<digits>` or null. */
export function whatsappHref(whatsapp: string | null): string | null {
  const digits = whatsapp?.replace(/\D/g, "") ?? "";
  return digits ? `https://wa.me/${digits}` : null;
}

/** `https://t.me/<username>` or null. */
export function telegramHref(telegram: string | null): string | null {
  const handle = telegram?.replace(/^@/, "") ?? "";
  return handle ? `https://t.me/${handle}` : null;
}
