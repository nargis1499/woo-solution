import "server-only";
import { preload } from "react-dom";
import assets from "@/lib/typography/assets.json";
import type { FontRoles } from "@/lib/typography/catalog";
/** Prioritize only the selected normal body face. React deduplicates this with
 * stylesheet use; title/button faces remain demand-loaded, not eagerly fetched. */
export function preloadBodyFont(roles: FontRoles) {
  const files = assets[roles.body].files;
  const face = files.find((file) => file.weight === "400") ?? files[0];
  preload(face.url, {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
}
