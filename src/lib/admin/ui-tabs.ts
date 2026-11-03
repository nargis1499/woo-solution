import { HouseIcon, MenuIcon, PaintbrushIcon, TypeIcon } from "lucide-react";

/** Tabs on /nemesis/ui. Add one here + a panel in src/components/admin/menu (or a sibling folder) – nothing else. */
export const UI_TABS = [
  { id: "menu", label: "Menu", icon: MenuIcon },
  { id: "home", label: "Home page", icon: HouseIcon },
  { id: "typography", label: "Typography", icon: TypeIcon },
  { id: "extra", label: "Colors", icon: PaintbrushIcon },
] as const;

export type UiTabId = (typeof UI_TABS)[number]["id"];

export function isUiTab(value: string | undefined): value is UiTabId {
  return UI_TABS.some((t) => t.id === value);
}
