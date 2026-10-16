"use client";

import { useRef, useState } from "react";
import {
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorThumb,
  SliderThumb,
  SliderTrack,
  parseColor,
  type Color,
} from "react-aria-components";
import { PipetteIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseColor as parseCssColor, toHex, toHslString, toRgbString } from "@/lib/theme";

type Format = "hex" | "rgb" | "hsl";

const FORMATS: Format[] = ["hex", "rgb", "hsl"];

const HUE_GRADIENT =
  "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))";

/** `#4f46e5` → `rgb(79, 70, 229)` / `hsl(243, 75%, 59%)` (falls back to the raw text for odd input). */
function formatValue(value: string, format: Format): string {
  const rgb = parseCssColor(value);
  if (!rgb) return value;
  if (format === "hex") return toHex(rgb);
  if (format === "rgb") return toRgbString(rgb);
  return toHslString(rgb);
}

/**
 * Colour field of Extra → Theme Customization.
 *
 * One swatch opens a full picker: saturation/brightness area, hue slider, the
 * same colour typed as HEX / RGB / HSL, handy swatches and an eyedropper.
 * `value === null` means "the template colour is still in use".
 */
export function ThemeColorField({
  id,
  label,
  value,
  fallback,
  onChange,
  onClear,
  testId,
}: {
  id: string;
  label: string;
  /** null = template default is in use */
  value: string | null;
  /** the template's own colour, previewed while no override is set */
  fallback: string;
  onChange: (value: string) => void;
  onClear: () => void;
  testId?: string;
}) {
  const current = value ?? fallback;
  const [format, setFormat] = useState<Format>("hex");
  const [text, setText] = useState(() => formatValue(current, format));
  const [touched, setTouched] = useState(false);
  /** true while the admin is typing in the field – then the text is left exactly as typed */
  const [editing, setEditing] = useState(false);
  const [seenColor, setSeenColor] = useState(current);
  const nativeInput = useRef<HTMLInputElement | null>(null);

  // Derived state during render (the codebase's pattern for "server/other control changed"):
  // the picker, a preset or Reset moved the colour – follow it, unless the field is being edited.
  if (seenColor !== current) {
    setSeenColor(current);
    if (!editing) {
      setText(formatValue(current, format));
      setTouched(false);
    }
  }

  const invalid = touched && !parseCssColor(text);

  function pick(next: Color) {
    onChange(next.toString("hex"));
  }

  function eyedropper() {
    type EyeDropperWindow = Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
    const EyeDropper = (window as EyeDropperWindow).EyeDropper;
    if (!EyeDropper) {
      nativeInput.current?.click(); // Safari/Firefox fall back to the OS picker
      return;
    }
    new EyeDropper()
      .open()
      .then((result) => onChange(result.sRGBHex))
      .catch(() => {});
  }

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <PopoverTrigger>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          data-testid={testId ? `${testId}-trigger` : undefined}
          aria-label={`${label}: ${value ?? "template colour"}`}
        >
          <span
            className="size-4 rounded-[4px] border shadow-xs"
            style={value ? { backgroundColor: value } : { backgroundImage: `linear-gradient(135deg, ${fallback} 0 55%, transparent 55%)` }}
          />
          <span className="font-mono text-xs tabular-nums">{value ? formatValue(value, format) : "Template"}</span>
        </Button>
        <Popover placement="bottom start" className="w-72">
          <ColorPicker value={parseColor(current) ?? undefined} onChange={pick}>
            <div className="space-y-3">
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              aria-label={`${label} saturation and brightness`}
              className="h-32 w-full overflow-hidden rounded-lg border"
            >
              <ColorThumb className="size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/25%)]" />
            </ColorArea>

            <ColorSlider channel="hue" colorSpace="hsl" aria-label={`${label} hue`} className="w-full">
              <SliderTrack className="relative h-3 w-full overflow-hidden rounded-full border" style={{ background: HUE_GRADIENT }}>
                <SliderThumb className="top-[50%] size-4 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgb(0_0_0/25%)] focus-visible:ring-3 focus-visible:ring-ring/50" />
              </SliderTrack>
            </ColorSlider>

            {/* HEX / RGB / HSL – one field, three formats (typing any of them works) */}
            <div className="flex items-center gap-1">
              <div className="flex shrink-0 rounded-md border p-0.5" role="group" aria-label={`${label} format`}>
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFormat(f);
                      setText(formatValue(current, f));
                      setTouched(false);
                    }}
                    aria-pressed={format === f}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      format === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <Input
                id={`${id}-text`}
                data-testid={testId ? `${testId}-input` : undefined}
                value={text}
                aria-label={`${label} value`}
                aria-invalid={invalid || undefined}
                data-invalid={invalid || undefined}
                className="h-8 font-mono text-xs"
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false);
                  setText(formatValue(current, format));
                  setTouched(false);
                }}
                onChange={(e) => {
                  setTouched(true);
                  setText(e.target.value);
                  if (parseCssColor(e.target.value)) onChange(e.target.value.trim());
                }}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`${label} eyedropper`} onClick={eyedropper} data-testid={testId ? `${testId}-eyedropper` : undefined}>
                <PipetteIcon />
              </Button>
              <input
                ref={nativeInput}
                type="color"
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none absolute size-0 opacity-0"
                value={parseCssColor(current) ? toHex(parseCssColor(current)!) : "#000000"}
                onChange={(e) => onChange(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                {QUICK_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => onChange(swatch)}
                    aria-label={swatch}
                    title={swatch}
                    className="size-5 rounded border transition-transform hover:scale-110"
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClear}
                isDisabled={!value}
                data-testid={testId ? `${testId}-reset` : undefined}
              >
                <RotateCcwIcon /> Template
              </Button>
            </div>
            </div>
          </ColorPicker>
        </Popover>
      </PopoverTrigger>
    </div>
  );
}

const QUICK_SWATCHES = ["#4f46e5", "#7f54b3", "#e11d48", "#f97316", "#059669", "#0891b2", "#0f172a", "#111827"];
