import { preloadBodyFont } from "@/components/typography/preload-font";
import { TypographyScope } from "@/components/typography/typography-scope";
import { getSiteSettings } from "@/lib/site-settings";
import { NotFoundContent } from "@/components/not-found-content";
import { StoreShell } from "@/components/store-shell";

/** Unknown URLs render outside every route group → bring the storefront chrome along. */
export default async function NotFound() {
  const settings = await getSiteSettings();
  preloadBodyFont(settings.typography.store);
  return (
    <TypographyScope scope="store" roles={settings.typography.store}>
      <StoreShell>
        <NotFoundContent />
      </StoreShell>
    </TypographyScope>
  );
}
