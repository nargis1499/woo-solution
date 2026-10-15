import type { ReactNode } from "react";
import { siteJsonLd } from "@/lib/seo";
import { Footer } from "./footer";
import { Header } from "./header";

export async function StoreShell({ children }: { children: ReactNode }) {
  const jsonLd = await siteJsonLd();
  return (
    <>
      {jsonLd && (
        // Organization + WebSite structured data (Settings → SEO / General)
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      )}
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
