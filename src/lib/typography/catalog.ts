export const FONT_NAMES = [
  "Inter",
  "Poppins",
  "Roboto",
  "DM Sans",
  "Montserrat",
  "Plus Jakarta Sans",
  "Open Sans",
  "Lato",
  "Playfair Display",
  "Manrope",
  "Outfit",
  "Nunito Sans",
  "Lora",
  "Source Sans 3",
  "Work Sans",
  "Rubik",
  "Sora",
  "Space Grotesk",
  "Oswald",
  "Merriweather",
  "Geist",
  "IBM Plex Sans",
  "Public Sans",
] as const;
export type FontName = (typeof FONT_NAMES)[number];
export type FontRoles = { title: FontName; body: FontName; button: FontName };
export type Typography = { store: FontRoles; admin: FontRoles };
export type TypographyScope = keyof Typography;
export const DEFAULT_TYPOGRAPHY: Typography = {
  store: { title: "Plus Jakarta Sans", body: "Inter", button: "Inter" },
  admin: { title: "Inter", body: "Inter", button: "Inter" },
};
export const ROLES = ["title", "body", "button"] as const;
export function isFontName(value: unknown): value is FontName {
  return typeof value === "string" && FONT_NAMES.includes(value as FontName);
}
export function normaliseTypography(value: unknown): Typography {
  const input = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    (["store", "admin"] as const).map((scope) => {
      const roles = (
        input[scope] && typeof input[scope] === "object" ? input[scope] : {}
      ) as Record<string, unknown>;
      return [
        scope,
        Object.fromEntries(
          ROLES.map((role) => [
            role,
            isFontName(roles[role])
              ? roles[role]
              : DEFAULT_TYPOGRAPHY[scope][role],
          ]),
        ),
      ];
    }),
  ) as Typography;
}
export function validateTypographyChanges(value: unknown): Partial<Typography> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid typography settings.");
  const entries = Object.entries(value);
  if (
    !entries.length ||
    entries.some(([scope]) => scope !== "store" && scope !== "admin")
  )
    throw new Error("Choose Store or Admin typography.");
  for (const [, roles] of entries) {
    if (
      !roles ||
      typeof roles !== "object" ||
      Array.isArray(roles) ||
      Object.keys(roles).length !== 3 ||
      ROLES.some(
        (role) =>
          !Object.hasOwn(roles, role) ||
          !isFontName((roles as Record<string, unknown>)[role]),
      )
    )
      throw new Error("Choose a supported font for all three roles.");
  }
  return value as Partial<Typography>;
}
export function selectedFonts(roles: FontRoles): FontName[] {
  return [...new Set(ROLES.map((role) => roles[role]))];
}
export function fontFamily(name: FontName): string {
  return `"Commerce ${name}", ${["Playfair Display", "Lora", "Merriweather"].includes(name) ? 'Georgia, "Times New Roman", serif' : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'}`;
}
export function typographyVariables(roles: FontRoles) {
  return {
    "--font-title": fontFamily(roles.title),
    "--font-body": fontFamily(roles.body),
    "--font-button": fontFamily(roles.button),
  };
}

/** Keep only locally edited scopes when restoring a tab draft, so a newer saved
 * Admin configuration is not lost while recovering unsaved Store changes. */
export function recoverTypographyDraft(
  saved: Typography,
  serialized: string | null,
): Typography | null {
  try {
    const stored = JSON.parse(serialized || "null");
    if (typeof stored?.base !== "string" || !stored?.value) return null;
    const base = normaliseTypography(JSON.parse(stored.base));
    const local = normaliseTypography(stored.value);
    const restored = { ...saved };
    for (const scope of ["store", "admin"] as const)
      if (JSON.stringify(local[scope]) !== JSON.stringify(base[scope]))
        restored[scope] = local[scope];
    return restored;
  } catch {
    return null;
  }
}
