import { preloadBodyFont } from "@/components/typography/preload-font";
import { TypographyScope } from "@/components/typography/typography-scope";
import { getSiteSettings } from "@/lib/site-settings";
import type { ReactNode } from "react";
import { StoreShell } from "@/components/store-shell";

/** Storefront chrome: sticky header with navigation + footer around every shop page. */
export default async function StoreLayout({ children }: { children: ReactNode }) {
  const settings = await getSiteSettings();
  preloadBodyFont(settings.typography.store);
  return (
    <TypographyScope scope="store" roles={settings.typography.store}>
      <StoreShell>{children}</StoreShell>
    </TypographyScope>
  );
}
