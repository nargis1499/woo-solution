/**
 * Theme Customization (Extra → Theme Customization).
 *
 * The admin picks the colours of five UI elements per mode plus optional
 * gradients for the three places that can carry one. Everything is stored
 * as CSS on the `site_settings` row and turned into design-token overrides by
 * `themeVars()` – a **pure** function so the server can inject the same CSS the
 * editor previews live in the browser.
 *
 * A key that the admin never touched stays `null` and is simply not emitted:
 * the template keeps its own value for that token (that is what makes
 * "Reset to defaults" and the untouched look identical).
 */

export const THEME_COLOR_KEYS = ["primary", "secondary", "button", "button_hover", "loader"] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** `null` = use the template's own colour for this token. */
export type ThemeColors = Record<ThemeColorKey, string | null>;

export const THEME_GRADIENT_KEYS = ["button", "loader", "hero"] as const;
export type ThemeGradientKey = (typeof THEME_GRADIENT_KEYS)[number];

export type GradientType = "linear" | "radial";

export type ThemeGradient = {
  enabled: boolean;
  type: GradientType;
  /** Degrees for a linear gradient (0 = to top, 90 = to right). */
  angle: number;
  from: string;
  /** Optional middle stop. */
  via: string | null;
  to: string;
};

export type ThemeGradients = Record<ThemeGradientKey, ThemeGradient>;

export type ThemeCustomization = {
  light: ThemeColors;
  dark: ThemeColors;
  gradients: ThemeGradients;
  /** Use the light palette in dark mode too. */
  sync: boolean;
};

/** Labels for the editor + the token each colour drives. */
export const THEME_COLOR_FIELDS: { key: ThemeColorKey; label: string; description: string }[] = [
  { key: "primary", label: "Primary", description: "Links, badges, active states, focus rings" },
  { key: "secondary", label: "Secondary", description: "Secondary buttons, chips, muted surfaces" },
  { key: "button", label: "Button", description: "Primary buttons (Add to cart, Save, Checkout)" },
  { key: "button_hover", label: "Button hover / active", description: "The shade a primary button turns under the pointer" },
  { key: "loader", label: "Loading bar", description: "The progress bar along the top while a page loads" },
];

export const THEME_GRADIENT_FIELDS: { key: ThemeGradientKey; label: string; description: string }[] = [
  { key: "button", label: "Button gradient", description: "Fills primary buttons instead of the flat button colour" },
  { key: "loader", label: "Loading bar gradient", description: "Fills the top progress bar instead of its flat colour" },
  { key: "hero", label: "Hero gradient", description: "Background of the home page hero section" },
];

/* ── Template defaults ───────────────────────────────────────────────────────
 * The exact colours in globals.css, so the previews can show "what the template
 * uses today" and the reset button can restore them for both modes.
 */
const LIGHT_PRIMARY = "#7f54b3";

export const TEMPLATE_DEFAULTS: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    primary: "#7f54b3",
    secondary: "#f5f5f5",
    button: "#7f54b3",
    button_hover: "#a27fcc",
    loader: "#7f54b3",
  },
  dark: {
    primary: "#b592e0",
    secondary: "#262626",
    button: "#b592e0",
    button_hover: "#c9aef0",
    loader: "#b592e0",
  },
};

/** Reset writes these (same values as an untouched template – see the module doc). */
export const DEFAULT_THEME: ThemeCustomization = {
  light: { primary: null, secondary: null, button: null, button_hover: null, loader: null },
  dark: { primary: null, secondary: null, button: null, button_hover: null, loader: null },
  sync: false,
  gradients: {
    button: { enabled: false, type: "linear", angle: 135, from: LIGHT_PRIMARY, via: null, to: "#5b3d8a" },
    loader: { enabled: false, type: "linear", angle: 90, from: LIGHT_PRIMARY, via: null, to: "#4cc9f0" },
    hero: { enabled: false, type: "linear", angle: 120, from: LIGHT_PRIMARY, via: null, to: "#3f2d63" },
  },
};

/* ── Colour helpers ─────────────────────────────────────────────────────── */

export type Rgb = { r: number; g: number; b: number; a: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number) => Math.round(clamp(n, 0, 255));

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/**
 * Reads a colour the admin typed: `#rgb`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()/rgba()`, `hsl()/hsla()` (commas and spaces both) or `transparent`.
 * Returns null for anything else, so validation and the parsers agree.
 */
export function parseColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const h = hex[1];
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
    if (h.length === 3 || h.length === 4) {
      return { r: expand(h[0]), g: expand(h[1]), b: expand(h[2]), a: h.length === 4 ? expand(h[3]) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: expand(h.slice(0, 2)),
        g: expand(h.slice(2, 4)),
        b: expand(h.slice(4, 6)),
        a: h.length === 8 ? expand(h.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(\s*([^)]+)\)$/.exec(value);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alphaPart = parts[3];
  /** `50%` → 50 (percent of 255 / of 100) …plain numbers stay as they are. */
  const num = (v: string, percentOf: number) => {
    const n = v.endsWith("%") ? (parseFloat(v) / 100) * percentOf : parseFloat(v);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  /** `84%` → 0.84, `0.84` → 0.84 */
  const fraction = (v: string) => {
    const n = v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  if (fn[1].startsWith("rgb")) {
    const [r, g, b] = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r: round(r), g: round(g), b: round(b), a: alphaPart === undefined ? 1 : clamp(fraction(alphaPart), 0, 1) };
  }
  const h = parseFloat(parts[0]);
  const s = fraction(parts[1]);
  const l = fraction(parts[2]);
  if ([h, s, l].some(Number.isNaN)) return null;
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: round(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: round(hueToRgb(p, q, hue) * 255),
    b: round(hueToRgb(p, q, hue - 1 / 3) * 255),
    a: alphaPart === undefined ? 1 : clamp(fraction(alphaPart), 0, 1),
  };
}

export const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((c) => round(c).toString(16).padStart(2, "0")).join("")}`;

export const toRgbString = ({ r, g, b, a }: Rgb): string =>
  a >= 1 ? `rgb(${round(r)}, ${round(g)}, ${round(b)})` : `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Number(a.toFixed(2))})`;

export function toHsl({ r, g, b, a }: Rgb): { h: number; s: number; l: number; a: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100), a };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100), a };
}

export const toHslString = (rgb: Rgb): string => {
  const { h, s, l, a } = toHsl(rgb);
  return a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${Number(a.toFixed(2))})`;
};

/** Relative luminance (WCAG) – used to pick a readable foreground. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white text on `color`, whichever is readable. */
export function contrastForeground(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return "#ffffff";
  return luminance(rgb) > 0.45 ? "#111111" : "#ffffff";
}

/* ── Gradients ──────────────────────────────────────────────────────────── */

/** Average of several colours – used to judge how light a gradient is overall. */
export function mixStops(stops: string[]): string {
  const rgb = stops.map(parseColor).filter((c): c is Rgb => Boolean(c));
  if (rgb.length === 0) return "#000000";
  const mix = rgb.reduce((acc, c) => ({ r: acc.r + c.r / rgb.length, g: acc.g + c.g / rgb.length, b: acc.b + c.b / rgb.length }), { r: 0, g: 0, b: 0 });
  return toHex({ ...mix, a: 1 });
}

export function gradientCss(g: ThemeGradient): string {
  const stops = [g.from, g.via, g.to].filter((s): s is string => Boolean(s)).join(", ");
  if (g.type === "radial") return `radial-gradient(circle at 50% 50%, ${stops})`;
  return `linear-gradient(${g.angle}deg, ${stops})`;
}

const gradientVar: Record<ThemeGradientKey, string> = {
  button: "--button-image",
  loader: "--loader-image",
  hero: "--hero-image",
};

/* ── Design-token overrides ─────────────────────────────────────────────── */

/**
 * CSS custom properties for one mode. Only the tokens the admin actually
 * customised are emitted; the matching foregrounds, focus rings and sidebar
 * accents are derived so a custom colour never breaks readability.
 */
export function themeVars(colors: ThemeColors, gradients?: ThemeGradients): Record<string, string> {
  const vars: Record<string, string> = {};
  const { primary, secondary, button, button_hover, loader } = colors;

  if (primary) {
    const onPrimary = contrastForeground(primary);
    vars["--primary"] = primary;
    vars["--primary-foreground"] = onPrimary;
    vars["--ring"] = `color-mix(in oklab, ${primary} 70%, var(--background))`;
    vars["--accent"] = `color-mix(in oklab, ${primary} 12%, var(--background))`;
    vars["--accent-foreground"] = `color-mix(in oklab, ${primary} 70%, var(--foreground))`;
    vars["--sidebar-primary"] = primary;
    vars["--sidebar-primary-foreground"] = onPrimary;
    vars["--sidebar-accent"] = `color-mix(in oklab, ${primary} 12%, var(--background))`;
    vars["--sidebar-accent-foreground"] = `color-mix(in oklab, ${primary} 70%, var(--foreground))`;
    vars["--sidebar-ring"] = `color-mix(in oklab, ${primary} 70%, var(--background))`;
    vars["--chart-1"] = primary;
  }

  if (secondary) {
    vars["--secondary"] = secondary;
    vars["--secondary-foreground"] = contrastForeground(secondary);
  }

  const buttonColor = button ?? primary;
  if (buttonColor) {
    vars["--button"] = buttonColor;
    vars["--button-foreground"] = contrastForeground(buttonColor);
    // Legacy look: `hover:bg-primary/80` – only when the admin set no hover colour of their own.
    vars["--button-hover"] = button_hover ?? `color-mix(in oklab, ${buttonColor} 80%, transparent)`;
    vars["--button-hover-foreground"] = contrastForeground(button_hover ?? buttonColor);
  } else if (button_hover) {
    vars["--button-hover"] = button_hover;
    vars["--button-hover-foreground"] = contrastForeground(button_hover);
  }

  const loaderColor = loader ?? primary;
  if (loaderColor) vars["--loader"] = loaderColor;

  for (const key of THEME_GRADIENT_KEYS) {
    const gradient = gradients?.[key];
    if (gradient?.enabled && gradient.from && gradient.to) {
      vars[gradientVar[key]] = gradientCss(gradient);
    }
  }

  // The hero carries the headline: with a gradient behind it, the readable text colour has to
  // come from the gradient's own stops, not from --primary (a light dark-mode primary would
  // otherwise put dark text on a dark gradient).
  const hero = gradients?.hero;
  if (hero?.enabled && hero.from && hero.to) {
    vars["--hero-foreground"] = contrastForeground(mixStops([hero.from, hero.via, hero.to].filter((s): s is string => Boolean(s))));
  }

  return vars;
}

/** `:root{…}.dark{…}` – what the root layout injects into the document. */
export function themeCss(theme: ThemeCustomization): string {
  const light = themeVars(theme.light, theme.gradients);
  const dark = themeVars(theme.sync ? theme.light : theme.dark, theme.gradients);
  const block = (selector: string, vars: Record<string, string>) => {
    const body = Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    return body ? `${selector}{${body}}` : "";
  };
  // `:root` before `.dark`: equal specificity, so the later rule wins for dark mode.
  return block(":root", light) + block(".dark", dark);
}

/* ── Validation ─────────────────────────────────────────────────────────── */

const isColor = (v: unknown): v is string => typeof v === "string" && parseColor(v) !== null;
const colorOrNull = (v: unknown): string | null => (isColor(v) ? v.trim() : null);

export function normaliseColors(raw: unknown): ThemeColors {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as ThemeColors;
  for (const key of THEME_COLOR_KEYS) out[key] = colorOrNull(row[key]);
  return out;
}

export function normaliseGradient(raw: unknown, fallback: ThemeGradient): ThemeGradient {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const angle = Number(row.angle);
  const via = colorOrNull(row.via);
  return {
    enabled: row.enabled === true,
    type: row.type === "radial" ? "radial" : "linear",
    angle: Number.isFinite(angle) ? clamp(Math.round(angle), 0, 360) : fallback.angle,
    from: isColor(row.from) ? row.from.trim() : fallback.from,
    via: via ?? (row.via === null || row.via === undefined ? null : fallback.via),
    to: isColor(row.to) ? row.to.trim() : fallback.to,
  };
}

export function normaliseGradients(raw: unknown): ThemeGradients {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as ThemeGradients;
  for (const key of THEME_GRADIENT_KEYS) out[key] = normaliseGradient(row[key], DEFAULT_THEME.gradients[key]);
  return out;
}

/** Any shape from the database (or a form field) → a usable theme. */
export function normaliseTheme(raw: {
  theme_light?: unknown;
  theme_dark?: unknown;
  theme_gradients?: unknown;
  theme_sync?: unknown;
}): ThemeCustomization {
  return {
    light: normaliseColors(raw.theme_light),
    dark: normaliseColors(raw.theme_dark),
    gradients: normaliseGradients(raw.theme_gradients),
    sync: raw.theme_sync === true,
  };
}

/* ── Presets ────────────────────────────────────────────────────────────── */

export type ThemePreset = {
  id: string;
  name: string;
  light: Required<ThemeColors>;
  dark: Required<ThemeColors>;
  /** Optional hero gradient that ships with the palette. */
  hero?: { from: string; to: string; angle: number };
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "indigo",
    name: "Modern Indigo",
    light: { primary: "#4f46e5", secondary: "#eef2ff", button: "#4f46e5", button_hover: "#4338ca", loader: "#6366f1" },
    dark: { primary: "#a5b4fc", secondary: "#27272a", button: "#6366f1", button_hover: "#818cf8", loader: "#818cf8" },
    hero: { from: "#4f46e5", to: "#0ea5e9", angle: 120 },
  },
  {
    id: "emerald",
    name: "Emerald Tech",
    light: { primary: "#059669", secondary: "#ecfdf5", button: "#10b981", button_hover: "#059669", loader: "#34d399" },
    dark: { primary: "#6ee7b7", secondary: "#1f2937", button: "#10b981", button_hover: "#34d399", loader: "#34d399" },
    hero: { from: "#047857", to: "#0f766e", angle: 135 },
  },
  {
    id: "coral",
    name: "Sunset Coral",
    light: { primary: "#e11d48", secondary: "#fff1f2", button: "#f43f5e", button_hover: "#e11d48", loader: "#fb7185" },
    dark: { primary: "#fda4af", secondary: "#2b1d22", button: "#f43f5e", button_hover: "#fb7185", loader: "#fb7185" },
    hero: { from: "#f97316", to: "#e11d48", angle: 115 },
  },
  {
    id: "ocean",
    name: "Ocean Cyan",
    light: { primary: "#0891b2", secondary: "#ecfeff", button: "#06b6d4", button_hover: "#0e7490", loader: "#22d3ee" },
    dark: { primary: "#67e8f9", secondary: "#183038", button: "#06b6d4", button_hover: "#22d3ee", loader: "#22d3ee" },
    hero: { from: "#0369a1", to: "#06b6d4", angle: 125 },
  },
  {
    id: "violet",
    name: "Violet Dusk",
    light: { primary: "#7c3aed", secondary: "#f5f3ff", button: "#8b5cf6", button_hover: "#7c3aed", loader: "#a78bfa" },
    dark: { primary: "#c4b5fd", secondary: "#241f37", button: "#8b5cf6", button_hover: "#a78bfa", loader: "#a78bfa" },
    hero: { from: "#4c1d95", to: "#a855f7", angle: 130 },
  },
  {
    id: "rose",
    name: "Rose Quartz",
    light: { primary: "#db2777", secondary: "#fdf2f8", button: "#ec4899", button_hover: "#db2777", loader: "#f472b6" },
    dark: { primary: "#f9a8d4", secondary: "#2b1c25", button: "#ec4899", button_hover: "#f472b6", loader: "#f472b6" },
    hero: { from: "#9d174d", to: "#f472b6", angle: 120 },
  },
  {
    id: "amber",
    name: "Amber Sunrise",
    light: { primary: "#b45309", secondary: "#fffbeb", button: "#f59e0b", button_hover: "#d97706", loader: "#fbbf24" },
    dark: { primary: "#fcd34d", secondary: "#2e2416", button: "#f59e0b", button_hover: "#fbbf24", loader: "#fbbf24" },
    hero: { from: "#d97706", to: "#fbbf24", angle: 110 },
  },
  {
    id: "forest",
    name: "Forest Pine",
    light: { primary: "#15803d", secondary: "#f0fdf4", button: "#16a34a", button_hover: "#15803d", loader: "#4ade80" },
    dark: { primary: "#86efac", secondary: "#16241c", button: "#22c55e", button_hover: "#4ade80", loader: "#4ade80" },
    hero: { from: "#166534", to: "#22c55e", angle: 140 },
  },
  {
    id: "teal",
    name: "Teal Lagoon",
    light: { primary: "#0f766e", secondary: "#f0fdfa", button: "#14b8a6", button_hover: "#0f766e", loader: "#2dd4bf" },
    dark: { primary: "#5eead4", secondary: "#152a2a", button: "#14b8a6", button_hover: "#2dd4bf", loader: "#2dd4bf" },
    hero: { from: "#134e4a", to: "#2dd4bf", angle: 135 },
  },
  {
    id: "sky",
    name: "Sky Breeze",
    light: { primary: "#0369a1", secondary: "#f0f9ff", button: "#0ea5e9", button_hover: "#0284c7", loader: "#38bdf8" },
    dark: { primary: "#7dd3fc", secondary: "#14252f", button: "#0ea5e9", button_hover: "#38bdf8", loader: "#38bdf8" },
    hero: { from: "#075985", to: "#38bdf8", angle: 125 },
  },
  {
    id: "crimson",
    name: "Crimson Ember",
    light: { primary: "#b91c1c", secondary: "#fef2f2", button: "#dc2626", button_hover: "#991b1b", loader: "#ef4444" },
    dark: { primary: "#fca5a5", secondary: "#2b1a1a", button: "#dc2626", button_hover: "#ef4444", loader: "#f87171" },
    hero: { from: "#7f1d1d", to: "#ef4444", angle: 115 },
  },
  {
    id: "graphite",
    name: "Graphite",
    light: { primary: "#334155", secondary: "#f1f5f9", button: "#334155", button_hover: "#1e293b", loader: "#64748b" },
    dark: { primary: "#cbd5e1", secondary: "#1e293b", button: "#475569", button_hover: "#94a3b8", loader: "#94a3b8" },
    hero: { from: "#0f172a", to: "#475569", angle: 120 },
  },
];

/** The palette a preset applies when "sync modes" is on: the light set, in both modes. */
export function presetColors(preset: ThemePreset, mode: "light" | "dark", sync: boolean): ThemeColors {
  const set = sync || mode === "light" ? preset.light : preset.dark;
  return { primary: set.primary, secondary: set.secondary, button: set.button, button_hover: set.button_hover, loader: set.loader };
}
