"use client";

import { createContext, useContext, type ReactNode } from "react";
import { USD_MONEY, type Money } from "@/lib/money";

const MoneyContext = createContext<Money>(USD_MONEY);

/**
 * Display currency + rate for client components (cart, checkout, product cards, the
 * admin price fields). Mounted once in the root layout from the cached site settings,
 * so a settings save refreshes it together with the rest of the shell.
 */
export function MoneyProvider({ money, children }: { money: Money; children: ReactNode }) {
  return <MoneyContext.Provider value={money}>{children}</MoneyContext.Provider>;
}

export function useMoney(): Money {
  return useContext(MoneyContext);
}
