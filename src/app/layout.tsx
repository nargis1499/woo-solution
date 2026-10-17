import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { getMoney, getSiteSettings } from "@/lib/site-settings";
import { ThemeCustomizationProvider } from "@/components/theme/theme-customization";
import { buildSiteMetadata } from "@/lib/seo";
import { MoneyProvider } from "@/components/money-provider";
import { Providers } from "@/components/providers";
import { TopLoader } from "@/components/top-loader";
import { AppToaster } from "@/components/app-toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const dynamic = "force-dynamic";

/** Title, description, robots, verification codes, Open Graph & favicon – all driven by Settings → SEO / General. */
export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await getSiteSettings());
}

/**
 * Root shell: fonts, theme + router + money (store currency) providers, the navigation
 * progress bar and the toast outlet. The storefront chrome (header / footer) lives in
 * `(store)/layout.tsx`; the admin dashboard brings its own sidebar shell.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Cached + tagged like the metadata above: the store currency is part of the static shell
  // and flips the moment Settings → WooCommerce is saved.
  const [money, settings] = await Promise.all([getMoney(), getSiteSettings()]);
  // Extra → Theme Customization (light/dark palette + gradients) rides along in the same
  // tagged settings row, so a save restyles the storefront on the next request.
  const theme = {
    light: settings.theme_light,
    dark: settings.theme_dark,
    gradients: settings.theme_gradients,
    sync: settings.theme_sync,
  };
  return (
    // suppressHydrationWarning: next-themes sets the `class`/`style` on <html> before React hydrates
    <html lang="en" className={`${inter.variable} h-full font-sans`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeCustomizationProvider theme={theme}>
        <Providers>
          <MoneyProvider money={money}>
            <Suspense fallback={null}>
              <TopLoader />
            </Suspense>
            {children}
            {/* Mounted here (not inside the animated page template) so it stays fixed to the viewport */}
            <AppToaster />
          </MoneyProvider>
        </Providers>
        </ThemeCustomizationProvider>
      </body>
    </html>
  );
}
