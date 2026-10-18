"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { CheckIcon, ChevronDownIcon, MoonIcon, PaintbrushIcon, RotateCcwIcon, ShoppingBagIcon, SunIcon } from "lucide-react";
import type { Key } from "react-aria-components";
import { updateTheme, type AdminFormState } from "@/app/nemesis/actions";
import {
  TEMPLATE_DEFAULTS,
  THEME_CHROME_SECTIONS,
  THEME_COLOR_FIELDS,
  contrastForeground,
  syncedForeground,
  templateTheme,
  THEME_GRADIENT_FIELDS,
  THEME_PRESET_CATEGORIES,
  THEME_PRESETS,
  gradientCss,
  presetColors,
  presetIdFor,
  presetLabel,
  themeVars,
  type ThemeColorKey,
  type ThemeColors,
  type ThemeCustomization,
  type ThemeGradient,
  type ThemeGradientKey,
  type ThemeGradientSets,
  type ThemeMode,
  type ThemePreset,
  type ThemePresetCategory,
} from "@/lib/theme";
import { startTransition, useActionState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton } from "@/components/admin/form-bits";
import { ThemeColorField } from "./color-field";
import { cn } from "@/lib/utils";

type Mode = ThemeMode;

const MODES: { id: Mode; label: string }[] = [
  { id: "light", label: "Light mode" },
  { id: "dark", label: "Dark mode" },
];

function resolveActiveThemeMode(resolvedTheme?: string): Mode {
  if (resolvedTheme === "dark" || resolvedTheme === "light") return resolvedTheme;
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  return "light";
}

function SmoothCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!open}
      inert={!open || undefined}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Extra → Theme Customization.
 *
 * One form holds the whole theme (both modes + gradients + the sync switch) and
 * saves it in one go; everything the admin does is previewed live by the
 * preview card below, which paints itself with the very same CSS variables the
 * storefront reads. No helper copy under the inputs – the option names say what
 * they do.
 */
export function ThemeEditor({ saved }: { saved: ThemeCustomization }) {
  const [state, dispatch, isPending] = useActionState<AdminFormState, FormData>(updateTheme, null);
  useFormToast(state);

  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const formRef = useRef<HTMLFormElement | null>(null);

  const [mode, setMode] = useState<Mode>(() => resolveActiveThemeMode(resolvedTheme));
  const [light, setLight] = useState<ThemeColors>(saved.light);
  const [dark, setDark] = useState<ThemeColors>(saved.dark);
  const [gradients, setGradients] = useState<ThemeGradientSets>(saved.gradients);
  const [sync, setSync] = useState(saved.sync);
  const [resetOpen, setResetOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [presetCategory, setPresetCategory] = useState<"all" | ThemePresetCategory>("all");
  const [colorsOpen, setColorsOpen] = useState(false);
  const [headerFooterOpen, setHeaderFooterOpen] = useState(false);
  const [gradientsOpen, setGradientsOpen] = useState(false);

  // Sync the active editor mode with the current theme mode on mount, when the global
  // theme mode is toggled, and when navigation routes change.
  useEffect(() => {
    setMode(resolveActiveThemeMode(resolvedTheme));
  }, [resolvedTheme, routeKey]);

  // Also sync when switching into the Extra tab inside /nemesis/ui (where TabsContent uses shouldForceMount).
  useEffect(() => {
    const panel = formRef.current?.closest('[role="tabpanel"]');
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (!panel.hasAttribute("data-inert") && !panel.hasAttribute("inert")) {
        setMode(resolveActiveThemeMode(resolvedTheme));
      }
    });
    observer.observe(panel, {
      attributes: true,
      attributeFilter: ["data-inert", "inert", "hidden"],
    });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  const colors = mode === "light" ? light : dark;
  const defaults = TEMPLATE_DEFAULTS[mode];
  // Gradients follow the mode too: the hero glows in the light palette in light mode and in the
  // dark one in dark mode. "Same colors for both modes" makes the light set win, like the colours.
  const modeGradients = sync ? gradients.light : gradients[mode];

  function setColor(key: ThemeColorKey, value: string | null) {
    const patch = (current: ThemeColors): ThemeColors => {
      const next: ThemeColors = { ...current, [key]: value };
      // Changing Header or Footer background automatically syncs its foreground text colour
      // so the pair always looks harmonious and readable.
      if (key === "header") next.header_foreground = value ? syncedForeground(value) : null;
      if (key === "footer") next.footer_foreground = value ? syncedForeground(value) : null;
      return next;
    };
    // Sync (or editing while synced) keeps both modes identical – one click, both themes.
    if (sync) {
      setLight(patch);
      setDark(patch);
    } else if (mode === "light") setLight(patch);
    else setDark(patch);
  }

  /**
   * A preset paints **the mode being edited** – Light and Dark each keep their
   * own palette, so the admin can run Modern Indigo in the dark and Emerald Tech
   * in the light. With "same colors for both modes" on there is one palette, so
   * both take it.
   */
  function applyPreset(preset: ThemePreset) {
    if (sync) {
      setLight((c) => presetColors(preset, "light", true, c));
      setDark((c) => presetColors(preset, "dark", true, c));
    } else if (mode === "light") {
      setLight((c) => presetColors(preset, "light", false, c));
    } else {
      setDark((c) => presetColors(preset, "dark", false, c));
    }
    // The preset also brings its hero gradient to the mode it was applied to, so a light-mode
    // Emerald and a dark-mode Indigo each get a hero that matches their palette.
    const hero = preset.hero;
    if (hero) {
      const next = { enabled: true, type: "linear" as const, angle: hero.angle, from: hero.from, via: null, to: hero.to };
      const modes: ThemeMode[] = sync ? ["light", "dark"] : [mode];
      setGradients((sets) => {
        const out = { ...sets };
        for (const m of modes) out[m] = { ...sets[m], hero: next };
        return out;
      });
    }
  }

  function resetAll() {
    const theme = templateTheme();
    setLight(theme.light);
    setDark(theme.dark);
    setGradients(theme.gradients);
    setSync(false);
    setMode(resolveActiveThemeMode(resolvedTheme));
    setResetOpen(false);
  }

  function setGradient(key: ThemeGradientKey, patch: Partial<ThemeGradient>) {
    const modes: ThemeMode[] = sync ? ["light", "dark"] : [mode];
    setGradients((sets) => {
      const out = { ...sets };
      for (const m of modes) out[m] = { ...sets[m], [key]: { ...sets[m][key], ...patch } };
      return out;
    });
  }

  const previewColors: ThemeColors = sync ? light : mode === "light" ? light : dark;
  const activePreset = { light: presetIdFor(light, "light", sync), dark: presetIdFor(dark, "dark", sync) };
  const presetPillBg = colors.primary ?? defaults.primary ?? "#7f54b3";
  const presetPillFg = contrastForeground(presetPillBg);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      <input type="hidden" name="theme_light" value={JSON.stringify(light)} />
      <input type="hidden" name="theme_dark" value={JSON.stringify(dark)} />
      <input type="hidden" name="theme_gradients" value={JSON.stringify(gradients)} />
      <input type="hidden" name="theme_sync" value={sync ? "on" : "off"} />

      {/* minmax(0,1fr) + min-w-0: a grid item may never grow past its column (mobile overflow) */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card className="gap-0 overflow-visible py-0">
            <div
              className="sticky top-14 z-20 rounded-t-xl border-b bg-card/95 px-6 py-5 backdrop-blur supports-[backdrop-filter]:bg-card/85"
              data-testid="theme-sticky-header"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-xl font-bold tracking-tight">Theme Customization</CardTitle>
                  <CardDescription>Colours and gradients of the whole store.</CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <SubmitButton pendingLabel="Saving…" pending={isPending}>
                      Save changes
                    </SubmitButton>
                    <AlertDialogTrigger isOpen={resetOpen} onOpenChange={setResetOpen}>
                      <Button type="button" variant="outline" data-testid="theme-reset">
                        <RotateCcwIcon /> Reset to defaults
                      </Button>
                      <AlertDialog data-testid="theme-reset-dialog">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reset the theme?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Every colour and gradient goes back to the template palette – in both modes. Save afterwards to publish it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <Button type="button" variant="destructive" onPress={resetAll} data-testid="theme-reset-confirm">
                            Reset colors
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialog>
                    </AlertDialogTrigger>
                  </div>
                  <p className="text-right text-xs text-muted-foreground" data-testid="theme-dirty">
                    {isPending ? "Saving…" : state?.success ? "Saved" : "Unsaved changes stay local"}
                  </p>
                  <FieldError>{state?.error}</FieldError>
                </div>
              </div>

              <div className="my-4 border-t" />

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <ToggleGroup
                    aria-label="Color mode"
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={new Set([mode])}
                    onSelectionChange={(keys: Set<Key>) => {
                      const next = [...keys][0];
                      if (next === "light" || next === "dark") setMode(next);
                    }}
                    className="w-fit rounded-lg border bg-muted/20 p-1"
                    data-testid="theme-mode"
                  >
                    {MODES.map((m) => {
                      const isSelected = m.id === mode;
                      return (
                        <ToggleGroupItem
                          key={m.id}
                          id={m.id}
                          size="sm"
                          className={cn(
                            "gap-2 rounded-md px-3 transition-colors",
                            isSelected
                              ? "theme-button shadow-xs data-selected:bg-(--button) data-selected:bg-[image:var(--button-image)] data-selected:text-(--button-foreground) data-selected:hover:bg-(--button-hover) data-selected:hover:text-(--button-hover-foreground) data-[selected]:bg-(--button) data-[selected]:bg-[image:var(--button-image)] data-[selected]:text-(--button-foreground)"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          data-testid={`theme-mode-${m.id}`}
                        >
                          {m.label}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500" data-testid="theme-mode-active">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                    Editing {mode === "light" ? "Light" : "Dark"} mode
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium select-none" data-testid="theme-sync-toggle">
                  <span>Apply to both modes</span>
                  <Switch
                    id="theme_sync"
                    aria-label="Apply to both modes"
                    isSelected={sync}
                    onChange={(checked) => {
                      setSync(checked);
                      if (checked) setDark(light);
                    }}
                  />
                </label>
              </div>
            </div>

            <CardContent className="space-y-4 pt-5 pb-6">

              <FieldSet className="rounded-lg border p-3.5" data-testid="theme-section-presets">
                <button
                  type="button"
                  aria-expanded={presetsOpen}
                  onClick={() => setPresetsOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="theme-section-presets-toggle"
                >
                  <div className="inline-flex flex-wrap items-center gap-2.5">
                    <span className="text-sm leading-none font-medium">Presets</span>
                    <span
                      className="inline-flex h-5 items-center rounded-full px-2.5 text-xs leading-none font-medium shadow-2xs"
                      style={{ backgroundColor: presetPillBg, color: presetPillFg }}
                      data-testid="theme-section-presets-pill"
                    >
                      {presetLabel(mode === "light" ? light : dark, mode, sync)}
                    </span>
                  </div>
                  <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", presetsOpen && "rotate-180")} aria-hidden />
                </button>
                <SmoothCollapse open={presetsOpen}>
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <div
                      className="flex flex-wrap items-center gap-2"
                      role="group"
                      aria-label="Filter color presets"
                      data-testid="theme-preset-filters"
                    >
                      {THEME_PRESET_CATEGORIES.map((cat) => {
                        const isSelected = presetCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setPresetCategory(cat.id)}
                            aria-pressed={isSelected}
                            data-testid={`theme-preset-filter-${cat.id}`}
                            className={cn(
                              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                              isSelected
                                ? "theme-button border-transparent font-semibold shadow-xs"
                                : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Each mode owns its palette: a click paints the mode being edited, so the
                        Light and Dark chips below can name two different presets. */}
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="theme-presets">
                      {(presetCategory === "all"
                        ? THEME_PRESETS
                        : THEME_PRESETS.filter((p) => p.category === presetCategory)
                      ).map((preset) => {
                        const set = sync || mode === "light" ? preset.light : preset.dark;
                        const swatches = [set.primary, set.secondary, set.button, set.button_hover, set.loader];
                        const isActive = activePreset[mode] === preset.id;
                        const otherMode = mode === "light" ? "dark" : "light";
                        const isOther = !sync && activePreset[otherMode] === preset.id;
                        const OtherIcon = otherMode === "dark" ? MoonIcon : SunIcon;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            aria-pressed={isActive}
                            data-active={isActive ? "true" : undefined}
                            data-testid={`theme-preset-${preset.id}`}
                            className={cn(
                              "relative rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                              isActive && "border-primary bg-accent ring-2 ring-primary",
                            )}
                          >
                            <span className="flex gap-1">
                              {swatches.map((c, i) => (
                                <span key={i} className="size-5 rounded-[4px] border" style={{ backgroundColor: c || "#000000" }} />
                              ))}
                            </span>
                            <span className={cn("mt-2 block text-sm font-medium", (isActive || isOther) && "pe-5")}>{preset.name}</span>
                            {isActive && (
                              <CheckIcon className="absolute end-2.5 top-2.5 size-4 text-primary" aria-hidden data-testid={`theme-preset-${preset.id}-active`} />
                            )}
                            {isOther && !isActive && (
                              <OtherIcon className="absolute end-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden data-testid={`theme-preset-${preset.id}-other`} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2" data-testid="theme-preset-modes">
                      {MODES.map((m) => {
                        const name = presetLabel(m.id === "light" ? light : dark, m.id, sync);
                        const ModeIcon = m.id === "light" ? SunIcon : MoonIcon;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMode(m.id)}
                            aria-pressed={mode === m.id}
                            data-testid={`theme-preset-${m.id}-label`}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                              mode === m.id ? "border-primary bg-accent" : "text-muted-foreground",
                            )}
                          >
                            <ModeIcon className="size-3.5" aria-hidden />
                            {m.id === "light" ? "Light" : "Dark"}
                            <span className="font-medium text-foreground" data-testid={`theme-preset-${m.id}-name`}>{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </SmoothCollapse>
              </FieldSet>

              <FieldSet className="rounded-lg border p-3.5" data-testid="theme-section-colors">
                <button
                  type="button"
                  aria-expanded={colorsOpen}
                  onClick={() => setColorsOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="theme-section-colors-toggle"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium">Colors</span>
                    <span className="flex items-center gap-1" aria-hidden>
                      {THEME_COLOR_FIELDS.map((field) => (
                        <span
                          key={field.key}
                          className="size-3.5 rounded-[3px] border"
                          style={{ backgroundColor: colors[field.key] ?? defaults[field.key] ?? "#000000" }}
                        />
                      ))}
                    </span>
                  </div>
                  <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", colorsOpen && "rotate-180")} aria-hidden />
                </button>
                <SmoothCollapse open={colorsOpen}>
                  <FieldGroup className="mt-3 gap-3 border-t pt-3">
                    {THEME_COLOR_FIELDS.map((field) => (
                      <div key={field.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                        <div className="min-w-40">
                          <p className="text-sm font-medium">{field.label}</p>
                          <p className="text-xs text-muted-foreground">{field.description}</p>
                        </div>
                        <ThemeColorField
                          id={`${mode}-${field.key}`}
                          label={`${field.label} (${mode})`}
                          value={colors[field.key]}
                          fallback={defaults[field.key] ?? "#000000"}
                          onChange={(value) => setColor(field.key, value)}
                          onClear={() => setColor(field.key, null)}
                          testId={`theme-color-${field.key}`}
                        />
                      </div>
                    ))}
                  </FieldGroup>
                </SmoothCollapse>
              </FieldSet>

              <FieldSet className="rounded-lg border p-3.5" data-testid="theme-header-footer">
                <button
                  type="button"
                  aria-expanded={headerFooterOpen}
                  onClick={() => setHeaderFooterOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="theme-section-header-footer-toggle"
                >
                  <div className="inline-flex flex-wrap items-center gap-2.5">
                    <span className="text-sm leading-none font-medium">Header &amp; Footer</span>
                    <span
                      className="inline-flex h-5 items-center gap-1.5 rounded-full px-2.5 text-xs leading-none font-medium shadow-2xs"
                      style={{ backgroundColor: presetPillBg, color: presetPillFg }}
                      data-testid="theme-header-footer-mode"
                    >
                      {mode === "light" ? <SunIcon className="size-3" aria-hidden /> : <MoonIcon className="size-3" aria-hidden />}
                      {mode === "light" ? "Light" : "Dark"} mode
                    </span>
                  </div>
                  <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", headerFooterOpen && "rotate-180")} aria-hidden />
                </button>
                <SmoothCollapse open={headerFooterOpen}>
                  <div className="mt-3 space-y-4 border-t pt-3">
                    {THEME_CHROME_SECTIONS.map((section) => {
                      const bg = colors[section.bgKey] ?? defaults[section.bgKey] ?? "#ffffff";
                      const fg = colors[section.fgKey] ?? (colors[section.bgKey] ? syncedForeground(bg) : defaults[section.fgKey] ?? "#0f172a");
                      return (
                        <div key={section.id} className="space-y-3 rounded-md border p-3" data-testid={`theme-chrome-${section.id}`}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-40">
                              <p className="text-sm font-medium">{section.label}</p>
                              <p className="text-xs text-muted-foreground">{section.description}</p>
                            </div>
                            <span
                              className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium shadow-2xs"
                              style={{ backgroundColor: bg, color: fg }}
                              data-testid={`theme-color-${section.id}-contrast`}
                            >
                              <span>Synced preview</span>
                              <span className="font-mono text-[11px] opacity-85">{fg}</span>
                            </span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2.5">
                              <span className="text-xs font-medium">Background</span>
                              <ThemeColorField
                                id={`${mode}-${section.bgKey}`}
                                label={`${section.label} background (${mode})`}
                                value={colors[section.bgKey]}
                                fallback={defaults[section.bgKey] ?? "#ffffff"}
                                onChange={(value) => setColor(section.bgKey, value)}
                                onClear={() => setColor(section.bgKey, null)}
                                testId={`theme-color-${section.bgKey}`}
                              />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2.5">
                              <span className="text-xs font-medium">Foreground text</span>
                              <ThemeColorField
                                id={`${mode}-${section.fgKey}`}
                                label={`${section.label} foreground text (${mode})`}
                                value={colors[section.fgKey]}
                                fallback={fg}
                                onChange={(value) => setColor(section.fgKey, value)}
                                onClear={() => setColor(section.fgKey, colors[section.bgKey] ? syncedForeground(bg) : null)}
                                testId={`theme-color-${section.fgKey}`}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SmoothCollapse>
              </FieldSet>

              <FieldSet className="rounded-lg border p-3.5" data-testid="theme-section-gradients">
                <button
                  type="button"
                  aria-expanded={gradientsOpen}
                  onClick={() => setGradientsOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="theme-section-gradients-toggle"
                >
                  <div className="inline-flex flex-wrap items-center gap-2.5">
                    <span className="text-sm leading-none font-medium">Gradients</span>
                    <span
                      className="inline-flex h-5 items-center gap-1.5 rounded-full px-2.5 text-xs leading-none font-medium shadow-2xs"
                      style={{ backgroundColor: presetPillBg, color: presetPillFg }}
                      data-testid="theme-gradients-mode"
                    >
                      {mode === "light" ? <SunIcon className="size-3" aria-hidden /> : <MoonIcon className="size-3" aria-hidden />}
                      {mode === "light" ? "Light" : "Dark"} mode
                    </span>
                  </div>
                  <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", gradientsOpen && "rotate-180")} aria-hidden />
                </button>
                <SmoothCollapse open={gradientsOpen}>
                  <div className="mt-3 space-y-4 border-t pt-3">
              {THEME_GRADIENT_FIELDS.map((field) => {
                const g = modeGradients[field.key];
                return (
                  <div key={field.key} className="space-y-3 rounded-md border p-3" data-testid={`theme-gradient-${field.key}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-40">
                        <p className="text-sm font-medium">{field.label}</p>
                        <p className="text-xs text-muted-foreground">{field.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="hidden" name={`gradient_${field.key}_enabled`} value={g.enabled ? "on" : "off"} />
                        <Switch
                          aria-label={`Enable ${field.label.toLowerCase()}`}
                          isSelected={g.enabled}
                          onChange={(value) => setGradient(field.key, { enabled: value })}
                          data-testid={`theme-gradient-${field.key}-switch`}
                        />
                      </label>
                    </div>

                    {/* below xl the card lives in a narrow column (preview sidebar on lg) – two rows beat a squeezed slider */}
                    {g.enabled && (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[160px_120px_minmax(0,1fr)]">
                        <Field>
                          <FieldLabel htmlFor={`gradient-${field.key}-type`}>Type</FieldLabel>
                          <Select
                            aria-label={`${field.label} type`}
                            selectedKey={g.type}
                            onSelectionChange={(key) => setGradient(field.key, { type: key === "radial" ? "radial" : "linear" })}
                          >
                            <SelectTrigger id={`gradient-${field.key}-type`} className="w-full" data-testid={`theme-gradient-${field.key}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem id="linear">Linear</SelectItem>
                              <SelectItem id="radial">Radial</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field className={cn(g.type === "radial" && "opacity-50")}>
                          <FieldLabel htmlFor={`gradient-${field.key}-angle`}>Angle</FieldLabel>
                          <Input
                            id={`gradient-${field.key}-angle`}
                            type="number"
                            min={0}
                            max={360}
                            disabled={g.type === "radial"}
                            value={g.angle}
                            onChange={(e) => setGradient(field.key, { angle: Number(e.target.value) })}
                          />
                        </Field>
                        <Field className="sm:col-span-2 xl:col-span-1">
                          <FieldLabel htmlFor={`gradient-${field.key}-angle-slider`}>Direction</FieldLabel>
                          <Slider
                            id={`gradient-${field.key}-angle-slider`}
                            aria-label={`${field.label} angle`}
                            minValue={0}
                            maxValue={360}
                            step={5}
                            isDisabled={g.type === "radial"}
                            value={g.angle}
                            onChange={(value) => setGradient(field.key, { angle: value as number })}
                          />
                        </Field>
                      </div>
                    )}

                    {/* stops + preview on one row: `Field` is always `w-full`, so each gets its own column */}
                    {g.enabled && (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.2fr)]">
                        <Field>
                          <FieldLabel htmlFor={`gradient-${field.key}-from`}>From</FieldLabel>
                          <ThemeColorField
                            id={`gradient-${field.key}-from`}
                            label={`${field.label} start colour`}
                            value={g.from}
                            fallback={TEMPLATE_DEFAULTS[mode].primary ?? "#000000"}
                            onChange={(value) => setGradient(field.key, { from: value })}
                            onClear={() => setGradient(field.key, { from: TEMPLATE_DEFAULTS[mode].primary ?? "#000000" })}
                            testId={`theme-gradient-${field.key}-from`}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`gradient-${field.key}-via`}>Middle</FieldLabel>
                          <div className="flex items-center gap-2">
                            <ThemeColorField
                              id={`gradient-${field.key}-via`}
                              label={`${field.label} middle colour`}
                              value={g.via}
                              fallback={g.from}
                              onChange={(value) => setGradient(field.key, { via: value })}
                              onClear={() => setGradient(field.key, { via: null })}
                              testId={`theme-gradient-${field.key}-via`}
                            />
                            <Button type="button" variant="ghost" size="sm" onClick={() => setGradient(field.key, { via: g.via ? null : g.from })}>
                              {g.via ? "Remove" : "Add"}
                            </Button>
                          </div>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`gradient-${field.key}-to`}>To</FieldLabel>
                          <ThemeColorField
                            id={`gradient-${field.key}-to`}
                            label={`${field.label} end colour`}
                            value={g.to}
                            fallback={TEMPLATE_DEFAULTS[mode].primary ?? "#000000"}
                            onChange={(value) => setGradient(field.key, { to: value })}
                            onClear={() => setGradient(field.key, { to: TEMPLATE_DEFAULTS[mode].primary ?? "#000000" })}
                            testId={`theme-gradient-${field.key}-to`}
                          />
                        </Field>
                        <div className="min-w-0">
                          <FieldLabel htmlFor={`gradient-${field.key}-preview`}>Preview</FieldLabel>
                          <div
                            id={`gradient-${field.key}-preview`}
                            data-testid={`theme-gradient-${field.key}-preview`}
                            className="h-9 w-full rounded-md border"
                            style={{ backgroundImage: gradientCss(g) }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                </SmoothCollapse>
              </FieldSet>
            </CardContent>
          </Card>
        </div>

        {/* ── live preview ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-16 lg:self-start">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Preview</CardTitle>
              <CardDescription className="text-xs">{sync ? "Both Modes" : mode === "light" ? "Light Mode" : "Dark Mode"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn("overflow-hidden rounded-xl border", mode === "dark" && !sync && "dark")}
                data-testid="theme-preview"
                style={{ ...themeVars(previewColors, modeGradients), backgroundColor: "var(--background)", color: "var(--foreground)" } as CSSProperties}
              >
                <div className="theme-header flex items-center justify-between border-b px-4 py-2.5 text-xs" data-testid="preview-header">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="grid size-5 place-items-center rounded bg-primary text-primary-foreground ring-1 ring-current/15">
                      <ShoppingBagIcon className="size-3" aria-hidden />
                    </span>
                    Store header
                  </span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    <span className="text-foreground font-medium">Shop</span>
                    <span>Categories</span>
                  </span>
                </div>
                <div className="theme-hero px-4 py-6">
                  <p className="text-lg font-bold">Hero section</p>
                  <p className="text-sm opacity-80">Storefront headline area</p>
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" data-testid="preview-button">
                      Primary button
                    </Button>
                    <Button size="sm" variant="secondary" data-testid="preview-button-secondary">
                      Secondary
                    </Button>
                    <a href="#" className="text-sm font-medium underline underline-offset-4" style={{ color: "var(--primary)" }} onClick={(e) => e.preventDefault()}>
                      Primary link
                    </a>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-2/3 rounded-full" style={{ backgroundColor: "var(--loader)", backgroundImage: modeGradients.loader.enabled ? "var(--loader-image)" : undefined }} data-testid="preview-loader" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-secondary p-3 text-sm" style={{ color: "var(--secondary-foreground)" }} data-testid="preview-secondary-surface">
                    <PaintbrushIcon className="size-4" /> Secondary surface
                  </div>
                </div>
                <div className="theme-footer flex items-center justify-between border-t px-4 py-2.5 text-xs" data-testid="preview-footer">
                  <span className="font-medium text-foreground">Store footer</span>
                  <span className="text-muted-foreground">© Synced text</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card size="sm" className="py-3">
            <CardContent className="px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">Defaults</span>
                  <span className="text-[11px] text-muted-foreground">({mode === "light" ? "Light" : "Dark"} template)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {THEME_COLOR_FIELDS.map((field) => (
                    <span
                      key={field.key}
                      title={`${field.label}: ${TEMPLATE_DEFAULTS[mode][field.key]}`}
                      className="size-4 rounded-full border"
                      style={{ backgroundColor: TEMPLATE_DEFAULTS[mode][field.key] || "#000000" }}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
