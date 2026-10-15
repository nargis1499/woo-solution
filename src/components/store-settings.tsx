"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Storefront-wide switches from Settings → WooCommerce, made available to the
 * client islands (add-to-cart buttons, quantity pickers, cart) that cannot read
 * the database themselves. Provided by `StoreShell`.
 */
export type StoreSettings = {
  /** false = unlimited stock: no "sold out" states, no quantity caps */
  manageStock: boolean;
};

const StoreSettingsContext = createContext<StoreSettings>({ manageStock: true });

export function StoreSettingsProvider({ value, children }: { value: StoreSettings; children: ReactNode }) {
  return <StoreSettingsContext.Provider value={value}>{children}</StoreSettingsContext.Provider>;
}

export function useStoreSettings(): StoreSettings {
  return useContext(StoreSettingsContext);
}
