import assets from "./assets.json";
import {
  fontFamily,
  typographyVariables,
  selectedFonts,
  type FontName,
  type FontRoles,
  type TypographyScope,
} from "./catalog";
export function fontFaceCss(names: readonly FontName[]): string {
  return [...new Set(names)]
    .flatMap((name) =>
      assets[name].files.map(
        (file) =>
          `@font-face{font-family:"Commerce ${name}";font-style:normal;font-weight:${file.weight};font-display:swap;src:url("${file.url}") format("woff2");}`,
      ),
    )
    .join("\n");
}
export function roleCss(roles: FontRoles): string {
  return Object.entries(typographyVariables(roles))
    .map(([key, val]) => `${key}:${val};`)
    .join("");
}
export function scopeCss(scope: TypographyScope, roles: FontRoles): string {
  // Root variables also style body-portaled menus/dialogs/toasts. :has updates on
  // App Router navigation without a client effect, script or extra settings fetch.
  return `${fontFaceCss(selectedFonts(roles))}\n:root:has([data-typography-scope="${scope}"]),.${scope}-theme{${roleCss(roles)}}`;
}
export { fontFamily };
