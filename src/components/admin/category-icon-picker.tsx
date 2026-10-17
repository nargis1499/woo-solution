"use client";

import { useState } from "react";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import {
  CATEGORY_ICONS,
  CATEGORY_ICON_BY_ID,
  DEFAULT_CATEGORY_ICON,
  isCategoryIconId,
} from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import { CategoryIconFill } from "./category-icon-fill";

/** White or near-black glyph for a custom fill, whichever reads better. */
function onFill(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? "#111111" : "#ffffff";
}

/** Inline style for the gradient behind an icon (theme primary when no colour is set). */
export function iconFillStyle(color: string | null | undefined): React.CSSProperties {
  if (!color) return {};
  return { backgroundImage: `linear-gradient(135deg, ${color}, ${color}, ${color}66)`, color: onFill(color) };
}

/**
 * "Set icon" + its fill colour: one gradient circle with the current icon, the
 * button that opens the 24-icon library, and the colour picker right beside it.
 * Both values travel in hidden inputs, so they save with the rest of the form.
 * An empty icon means the shopping bag; an empty colour the theme primary.
 */
export function CategoryIconPicker({
  value,
  color,
  error,
  name = "icon",
  colorName = "icon_color",
}: {
  value?: string | null;
  color?: string | null;
  error?: string;
  name?: string;
  colorName?: string;
}) {
  const [selected, setSelected] = useState<string>(isCategoryIconId(value) ? value : "");
  const [fill, setFill] = useState<string | null>(color ?? null);
  const [open, setOpen] = useState(false);
  const Current = (selected && CATEGORY_ICON_BY_ID[selected]) || DEFAULT_CATEGORY_ICON;

  return (
    <div data-testid="category-icon-field" className="flex flex-col gap-2">
      <input type="hidden" name={name} value={selected} />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground ring-1 ring-border/60",
            !fill && "bg-linear-to-br from-primary via-primary to-primary/40",
          )}
          style={iconFillStyle(fill)}
          data-testid="category-icon-current"
          aria-hidden
        >
          <Current className="size-4" />
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onPress={() => setOpen(true)}
          data-testid="category-icon-trigger"
          className="justify-start"
        >
          Set icon
        </Button>
        <CategoryIconFill value={fill} onChange={setFill} name={colorName} />
        {selected && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPress={() => setSelected("")}
            data-testid="category-icon-remove"
          >
            <RotateCcwIcon /> Use default
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog
        isOpen={open}
        onOpenChange={setOpen}
        className="gap-4 sm:max-w-lg"
        data-testid="category-icon-dialog"
        aria-label="Icon library"
      >
        <DialogTitle>Icon library</DialogTitle>
        <div
          className="icon-scroll grid h-72 grid-cols-5 content-start gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-6"
          role="group"
          aria-label="Icons"
          data-testid="category-icon-grid"
        >
          {CATEGORY_ICONS.map(({ id, label, Icon }) => {
            const isSelected = id === selected;
            return (
              <Button
                key={id}
                type="button"
                variant="ghost"
                aria-label={label}
                aria-pressed={isSelected}
                data-testid={`category-icon-option-${id}`}
                data-selected={isSelected || undefined}
                onPress={() => {
                  setSelected(id);
                  setOpen(false);
                }}
                className={cn(
                  "relative grid aspect-square h-auto w-full place-items-center rounded-full p-0 text-primary-foreground hover:text-primary-foreground",
                  !fill && "bg-linear-to-br from-primary via-primary to-primary/40",
                  isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
                )}
                style={iconFillStyle(fill)}
              >
                <Icon className="size-5" aria-hidden />
                {isSelected && <CheckIcon className="absolute right-1 bottom-1 size-3.5" aria-hidden />}
              </Button>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}
