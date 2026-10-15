"use client";

import { useRouter } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import { RouterProvider } from "react-aria-components";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

/**
 * Client-side context for the whole app:
 * - next-themes: class-based dark mode (`<html class="dark">`), follows the OS by default.
 * - React Aria RouterProvider: every React Aria `Link`, menu item or breadcrumb with an
 *   `href` navigates through the Next.js router (client-side, no full reload).
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <RouterProvider navigate={router.push}>{children}</RouterProvider>
    </NextThemesProvider>
  );
}
