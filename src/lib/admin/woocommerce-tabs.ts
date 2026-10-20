import { CreditCardIcon, StoreIcon } from "lucide-react";

/** Tabs on /nemesis/woocommerce. */
export const WOOCOMMERCE_TABS = [
  { id: "general", label: "General", icon: StoreIcon },
  { id: "payment", label: "Payment", icon: CreditCardIcon },
] as const;

export type WoocommerceTabId = (typeof WOOCOMMERCE_TABS)[number]["id"];

export function isWoocommerceTab(value: string | undefined): value is WoocommerceTabId {
  return WOOCOMMERCE_TABS.some((t) => t.id === value);
}
