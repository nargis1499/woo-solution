import type { ReactNode } from "react";
import { StoreShell } from "@/components/store-shell";

/** Storefront chrome: sticky header with navigation + footer around every shop page. */
export default function StoreLayout({ children }: { children: ReactNode }) {
  return <StoreShell>{children}</StoreShell>;
}
