import type { ReactNode } from "react";
import { getSiteSettings } from "@/lib/site-settings";
import { siteJsonLd } from "@/lib/seo";
import { Footer } from "./footer";
import { Header } from "./header";
import { StoreSettingsProvider } from "./store-settings";

export async function StoreShell({ children }: { children: ReactNode }) {
  const [{ manage_stock }, jsonLd] = await Promise.all([getSiteSettings(), siteJsonLd()]);
  return (
    <StoreSettingsProvider value={{ manageStock: manage_stock }}>
      {jsonLd && (
        // Organization + WebSite structured data (Settings → SEO / General)
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      )}
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </StoreSettingsProvider>
  );
}
