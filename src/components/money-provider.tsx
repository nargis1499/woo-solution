"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SHIPPING_CONFIG, type ShippingConfig } from "@/lib/config";
import { USD_MONEY, type Money } from "@/lib/money";

const MoneyContext = createContext<Money>(USD_MONEY);
const ShippingContext = createContext<ShippingConfig>(DEFAULT_SHIPPING_CONFIG);

/**
 * Display currency + rate + shipping settings for client components (cart, checkout,
 * product cards, the admin price fields). Mounted once in the root layout from the
 * cached site settings, so a settings save refreshes it together with the rest of the shell.
 */
export function MoneyProvider({
  money,
  shipping = DEFAULT_SHIPPING_CONFIG,
  children,
}: {
  money: Money;
  shipping?: ShippingConfig;
  children: ReactNode;
}) {
  return (
    <MoneyContext.Provider value={money}>
      <ShippingContext.Provider value={shipping}>{children}</ShippingContext.Provider>
    </MoneyContext.Provider>
  );
}

export function useMoney(): Money {
  return useContext(MoneyContext);
}

export function useShipping(): ShippingConfig {
  return useContext(ShippingContext);
}
