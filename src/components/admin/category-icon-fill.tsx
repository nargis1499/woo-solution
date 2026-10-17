"use client";

import { useState } from "react";
import {
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorThumb,
  SliderThumb,
  SliderTrack,
  parseColor,
} from "react-aria-components";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HUE_GRADIENT =
  "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))";

const SWATCHES = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#eab308", "#f97316", "#e11d48", "#0f172a"];

/**
 * Icon fill: a swatch + hex field in a popover. `value === null` means the
 * theme's primary colour is in use; picking a colour stores `#rrggbb`.
 *
 * The swatch previews the theme colour through `var(--primary)`, so it always
 * matches the palette the storefront will use.
 */
export function CategoryIconFill({
  value,
  onChange,
  name = "icon_color",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  name?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const [typed, setTyped] = useState(value ?? "");
  const current = value ?? "#7c3aed"; // only seeds the picker while no colour is set

  if (typed !== (value ?? "")) {
    // the popover/presets moved the colour – follow it, unless the user is mid-keystroke
    setTyped(value ?? "");
    setText(value ?? "");
  }

  return (
    <PopoverTrigger>
      <input type="hidden" name={name} value={value ?? ""} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        aria-label={value ? `Icon fill ${value}` : "Icon fill — theme primary colour"}
        data-testid="category-icon-fill-trigger"
      >
        <span
          className="size-4 rounded-full border shadow-xs"
          style={value ? { backgroundColor: value } : { backgroundColor: "var(--primary)" }}
          data-testid="category-icon-fill-swatch"
        />
        <span className="font-mono text-xs tabular-nums">{value ? value.toUpperCase() : "Primary"}</span>
      </Button>
      <Popover placement="bottom start" className="w-72" isNonModal>
        <ColorPicker
          value={parseColor(current) ?? undefined}
          onChange={(color) => {
            const hex = color.toString("hex").slice(0, 7);
            onChange(hex);
            setText(hex);
          }}
        >
          <div className="space-y-3" data-testid="category-icon-fill-popover">
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              aria-label="Icon fill saturation and brightness"
              className="h-32 w-full overflow-hidden rounded-lg border"
            >
              <ColorThumb className="size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/25%)]" />
            </ColorArea>

            <ColorSlider channel="hue" colorSpace="hsl" aria-label="Icon fill hue" className="w-full">
              <SliderTrack className="relative h-3 w-full overflow-hidden rounded-full border" style={{ background: HUE_GRADIENT }}>
                <SliderThumb className="top-[50%] size-4 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgb(0_0_0/25%)] focus-visible:ring-3 focus-visible:ring-ring/50" />
              </SliderTrack>
            </ColorSlider>

            <Input
              value={text}
              aria-label="Icon fill value"
              placeholder="#7C3AED"
              className="h-8 font-mono text-xs uppercase"
              data-testid="category-icon-fill-input"
              onChange={(e) => {
                const next = e.target.value;
                setText(next);
                setTyped(/^#[0-9a-f]{6}$/i.test(next) ? next : (value ?? ""));
                if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next);
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={swatch}
                    data-testid={`category-icon-fill-swatch-${swatch.slice(1)}`}
                    className="size-5 rounded-full border transition-transform hover:scale-110"
                    style={{ backgroundColor: swatch }}
                    onClick={() => {
                      onChange(swatch);
                      setText(swatch);
                    }}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => onChange(null)}
                data-testid="category-icon-fill-reset"
                className={cn("shrink-0")}
              >
                <RotateCcwIcon /> Primary
              </Button>
            </div>
          </div>
        </ColorPicker>
      </Popover>
    </PopoverTrigger>
  );
}
