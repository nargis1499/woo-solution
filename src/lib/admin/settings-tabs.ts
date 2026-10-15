import { PackageIcon, SearchIcon, StoreIcon } from "lucide-react";

/** Tabs on /nemesis/settings. Add one here + a form in settings-forms.tsx + a Server Action – nothing else. */
export const SETTINGS_TABS = [
  { id: "general", label: "General", icon: StoreIcon },
  { id: "seo", label: "SEO", icon: SearchIcon },
  { id: "woocommerce", label: "WooCommerce", icon: PackageIcon },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function isSettingsTab(value: string | undefined): value is SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === value);
}
