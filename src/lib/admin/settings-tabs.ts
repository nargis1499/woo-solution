import { SearchIcon, SparklesIcon, StoreIcon, WrenchIcon } from "lucide-react";

/** Tabs on /nemesis/settings. Add one here + a form in settings-forms.tsx + a Server Action – nothing else. */
export const SETTINGS_TABS = [
  { id: "general", label: "General", icon: StoreIcon },
  { id: "seo", label: "SEO", icon: SearchIcon },
  { id: "ai", label: "AI", icon: SparklesIcon },
  { id: "advanced", label: "Advanced", icon: WrenchIcon },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function isSettingsTab(
  value: string | undefined,
): value is SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === value);
}
