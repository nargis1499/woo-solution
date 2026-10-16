"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_THEME, themeCss, type ThemeCustomization } from "@/lib/theme";

const ThemeCustomizationContext = createContext<ThemeCustomization>(DEFAULT_THEME);

/** The saved palette – used by client widgets that paint themselves (e.g. the top loading bar). */
export function useThemeCustomization(): ThemeCustomization {
  return useContext(ThemeCustomizationContext);
}

/**
 * Extra → Theme Customization, mounted once in the root layout.
 *
 * The palette reaches the browser two ways:
 *  - as a `<style>` tag rendered from the *saved* settings by the server, so the
 *    very first paint already carries the custom colours (no flash, no client
 *    round-trip) – see `themeCss()`;
 *  - through this context, for client components that need the values themselves
 *    (the loading bar renders a gradient with the theme's own CSS variable).
 */
export function ThemeCustomizationProvider({ theme, children }: { theme: ThemeCustomization; children: ReactNode }) {
  return (
    <ThemeCustomizationContext.Provider value={theme}>
      <style id="theme-customization" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      {children}
    </ThemeCustomizationContext.Provider>
  );
}
