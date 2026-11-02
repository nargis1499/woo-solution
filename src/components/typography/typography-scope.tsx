"use client";
import { useState, type ReactNode } from "react";
import {
  normaliseTypography,
  type FontRoles,
  type TypographyScope,
} from "@/lib/typography/catalog";
import { scopeCss } from "@/lib/typography/css";
import { useEffect } from "react";
export const TYPOGRAPHY_SAVED_EVENT = "commerce:typography-saved";
/** Server renders the exact selected faces and variables; the event updates the
 * persistent Admin layout after save without reloading or fetching settings. */
export function TypographyScope({
  scope,
  roles,
  children,
}: {
  scope: TypographyScope;
  roles: FontRoles;
  children: ReactNode;
}) {
  const [override, setOverride] = useState<{
    source: FontRoles;
    value: FontRoles;
  } | null>(null);
  const current = override?.source === roles ? override.value : roles;
  useEffect(() => {
    const listener = (event: Event) => {
      const config = normaliseTypography((event as CustomEvent).detail);
      setOverride({ source: roles, value: config[scope] });
    };
    window.addEventListener(TYPOGRAPHY_SAVED_EVENT, listener);
    return () => window.removeEventListener(TYPOGRAPHY_SAVED_EVENT, listener);
  }, [scope, roles]);
  return (
    <div className={`${scope}-theme contents`} data-typography-scope={scope}>
      <style data-typography-fonts={scope}>{scopeCss(scope, current)}</style>
      {children}
    </div>
  );
}
