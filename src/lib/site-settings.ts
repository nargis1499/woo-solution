import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { STORE_NAME } from "@/lib/config";
import type { SiteSettings } from "@/lib/types";

export const SITE_SETTINGS_TAG = "site-settings";

const DEFAULTS: SiteSettings = {
  store_name: STORE_NAME,
  tagline: null,
  support_email: null,
};

/**
 * Store name & co. as edited in /nemesis/settings.
 *
 * Cached with `"use cache"` and tagged, so the header/footer/metadata stay part
 * of the static shell; saving the settings form calls `updateTag()` which
 * refreshes it instantly. Falls back to the env defaults when the table is not
 * reachable (e.g. the migration hasn't been run yet) – with a short lifetime so
 * we retry soon.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  "use cache";
  cacheTag(SITE_SETTINGS_TAG);

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("store_name, tagline, support_email")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      cacheLife("seconds");
      return DEFAULTS;
    }

    cacheLife("days");
    return {
      store_name: data.store_name?.trim() || DEFAULTS.store_name,
      tagline: data.tagline || null,
      support_email: data.support_email || null,
    };
  } catch {
    cacheLife("seconds");
    return DEFAULTS;
  }
}
