"use client";

import { useState, type CSSProperties } from "react";
import { PaintbrushIcon, RotateCcwIcon } from "lucide-react";
import type { Key } from "react-aria-components";
import { updateTheme, type AdminFormState } from "@/app/nemesis/actions";
import {
  DEFAULT_THEME,
  TEMPLATE_DEFAULTS,
  THEME_COLOR_FIELDS,
  THEME_GRADIENT_FIELDS,
  THEME_PRESETS,
  gradientCss,
  presetColors,
  themeVars,
  type ThemeColorKey,
  type ThemeColors,
  type ThemeCustomization,
  type ThemeGradient,
  type ThemeGradientKey,
  type ThemeGradients,
} from "@/lib/theme";
import { startTransition, useActionState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormToast } from "@/components/admin/flash-toast";
import { CheckboxField, SubmitButton } from "@/components/admin/form-bits";
import { ThemeColorField } from "./color-field";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark";

const MODES: { id: Mode; label: string }[] = [
  { id: "light", label: "Light mode" },
  { id: "dark", label: "Dark mode" },
];

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

  const [mode, setMode] = useState<Mode>("light");
  const [light, setLight] = useState<ThemeColors>(saved.light);
  const [dark, setDark] = useState<ThemeColors>(saved.dark);
  const [gradients, setGradients] = useState<ThemeGradients>(saved.gradients);
  const [sync, setSync] = useState(saved.sync);
  const [resetOpen, setResetOpen] = useState(false);

  const colors = mode === "light" ? light : dark;
  const defaults = TEMPLATE_DEFAULTS[mode];

  function setColor(key: ThemeColorKey, value: string | null) {
    // Sync (or editing while synced) keeps both modes identical – one click, both themes.
    if (sync) {
      setLight((c) => ({ ...c, [key]: value }));
      setDark((c) => ({ ...c, [key]: value }));
    } else if (mode === "light") setLight((c) => ({ ...c, [key]: value }));
    else setDark((c) => ({ ...c, [key]: value }));
  }

  function applyPreset(index: number) {
    const preset = THEME_PRESETS[index];
    setLight(presetColors(preset, "light", sync));
    setDark(presetColors(preset, "dark", sync));
    if (preset.hero) {
      setGradients((g) => ({ ...g, hero: { ...g.hero, enabled: true, type: "linear", angle: preset.hero!.angle, from: preset.hero!.from, via: null, to: preset.hero!.to } }));
    }
  }

  function resetAll() {
    setLight(DEFAULT_THEME.light);
    setDark(DEFAULT_THEME.dark);
    setGradients(DEFAULT_THEME.gradients);
    setSync(false);
    setMode("light");
    setResetOpen(false);
  }

  function setGradient(key: ThemeGradientKey, patch: Partial<ThemeGradient>) {
    setGradients((g) => ({ ...g, [key]: { ...g[key], ...patch } }));
  }

  const previewColors: ThemeColors = sync ? light : mode === "light" ? light : dark;

  return (
    <form
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
          <Card>
            <CardHeader>
              <CardTitle>Theme Customization</CardTitle>
              <CardDescription>Colours and gradients of the whole store.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup
                  aria-label="Color mode"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={new Set([mode])}
                  onSelectionChange={(keys: Set<Key>) => {
                    const next = [...keys][0];
                    if (next === "light" || next === "dark") setMode(next);
                  }}
                  className="rounded-md border p-1"
                  data-testid="theme-mode"
                >
                  {MODES.map((m) => (
                    <ToggleGroupItem key={m.id} id={m.id} size="sm" className="gap-2 data-[selected]:bg-primary data-[selected]:text-primary-foreground" data-testid={`theme-mode-${m.id}`}>
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className="text-xs text-muted-foreground" data-testid="theme-mode-active">
                  Editing {mode === "light" ? "Light" : "Dark"} mode
                </span>
              </div>

              <CheckboxField
                name="theme_sync"
                id="theme_sync"
                label="Use the same colors for both Light & Dark modes"
                defaultChecked={sync}
                onChange={(checked) => {
                  setSync(checked);
                  if (checked) setDark(light);
                }}
              />

              <FieldSet>
                <FieldLegend variant="label">Colors</FieldLegend>
                <FieldGroup className="gap-3">
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
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Presets</FieldLegend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="theme-presets">
                  {THEME_PRESETS.map((preset, index) => {
                    const set = sync ? preset.light : mode === "light" ? preset.light : preset.dark;
                    const swatches = [set.primary, set.secondary, set.button, set.button_hover, set.loader];
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(index)}
                        className="rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        data-testid={`theme-preset-${preset.id}`}
                      >
                        <span className="flex gap-1">
                          {swatches.map((c, i) => (
                            <span key={i} className="size-5 rounded-[4px] border" style={{ backgroundColor: c || "#000000" }} />
                          ))}
                        </span>
                        <span className="mt-2 block text-sm font-medium">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </FieldSet>

              <FieldError>{state?.error}</FieldError>
            </CardContent>
            <CardFooter className="justify-between gap-3 border-t">
              <div className="flex items-center gap-3">
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
              <p className="text-xs text-muted-foreground" data-testid="theme-dirty">
                {isPending ? "Saving…" : state?.success ? "Saved" : "Unsaved changes stay local until you save"}
              </p>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gradients</CardTitle>
              <CardDescription>Linear or radial, two or three stops.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {THEME_GRADIENT_FIELDS.map((field) => {
                const g = gradients[field.key];
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

                    {g.enabled && (
                      <div className="grid gap-4 sm:grid-cols-[160px_120px_minmax(0,1fr)]">
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
                        <Field>
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
            </CardContent>
          </Card>
        </div>

        {/* ── live preview ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>{sync ? "Both modes" : mode === "light" ? "Light mode" : "Dark mode"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn("overflow-hidden rounded-xl border", mode === "dark" && !sync && "dark")}
                data-testid="theme-preview"
                style={{ ...themeVars(previewColors, gradients), backgroundColor: "var(--background)", color: "var(--foreground)" } as CSSProperties}
              >
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
                    <div className="h-full w-2/3 rounded-full" style={{ backgroundColor: "var(--loader)", backgroundImage: gradients.loader.enabled ? "var(--loader-image)" : undefined }} data-testid="preview-loader" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-secondary p-3 text-sm" style={{ color: "var(--secondary-foreground)" }} data-testid="preview-secondary-surface">
                    <PaintbrushIcon className="size-4" /> Secondary surface
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Defaults</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {THEME_COLOR_FIELDS.map((field) => (
                  <span
                    key={field.key}
                    title={`${field.label}: ${TEMPLATE_DEFAULTS[mode][field.key]}`}
                    className="size-6 rounded-md border"
                    style={{ backgroundColor: TEMPLATE_DEFAULTS[mode][field.key] || "#000000" }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{mode === "light" ? "Light" : "Dark"} template palette</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
