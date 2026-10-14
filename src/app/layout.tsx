import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { getSiteSettings } from "@/lib/site-settings";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/components/theme-provider";
import { TopLoader } from "@/components/top-loader";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { store_name, tagline } = await getSiteSettings();
  return {
    title: { default: store_name, template: `%s · ${store_name}` },
    description: tagline ?? `${store_name} — a modern storefront built with Next.js and Supabase.`,
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the `class`/`style` on <html> before React hydrates
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <Suspense fallback={null}>
            <TopLoader />
          </Suspense>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
