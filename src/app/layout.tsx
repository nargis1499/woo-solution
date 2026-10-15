import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { getSiteSettings } from "@/lib/site-settings";
import { Providers } from "@/components/providers";
import { TopLoader } from "@/components/top-loader";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { store_name, tagline } = await getSiteSettings();
  return {
    title: { default: store_name, template: `%s · ${store_name}` },
    description: tagline ?? `${store_name} — a modern storefront built with Next.js and Supabase.`,
  };
}

/**
 * Root shell: fonts, theme + router providers, the navigation progress bar and
 * the toast outlet. The storefront chrome (header / footer) lives in
 * `(store)/layout.tsx`; the admin dashboard brings its own sidebar shell.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the `class`/`style` on <html> before React hydrates
    <html lang="en" className={`${inter.variable} h-full font-sans`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={null}>
            <TopLoader />
          </Suspense>
          {children}
          {/* Mounted here (not inside the animated page template) so it stays fixed to the viewport */}
          <Toaster position="top-right" richColors closeButton duration={4500} visibleToasts={4} offset={{ top: 80 }} mobileOffset={{ top: 72 }} />
        </Providers>
      </body>
    </html>
  );
}
