"use client";

import { useState } from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  CATEGORY_ICONS,
  CATEGORY_ICON_BY_ID,
  DEFAULT_CATEGORY_ICON_IDS,
  DEFAULT_CATEGORY_ICONS,
  isCategoryIconId,
} from "@/lib/category-icons";
import { cn } from "@/lib/utils";

/**
 * Category → Icon: one gradient circle showing the current icon; the "icon box"
 * dialog holds the 22 icons and applies the one you click.
 *
 * The value travels in a hidden `icon` input, so it saves with the rest of the
 * form; an empty value means "rotate the defaults by position".
 */
export function CategoryIconPicker({
  value,
  error,
  name = "icon",
}: {
  value?: string | null;
  error?: string;
  name?: string;
}) {
  const [selected, setSelected] = useState<string>(isCategoryIconId(value) ? value : "");
  const [open, setOpen] = useState(false);
  const Current = (selected && CATEGORY_ICON_BY_ID[selected]) || DEFAULT_CATEGORY_ICONS[0];
  const currentLabel = CATEGORY_ICONS.find((option) => option.id === selected)?.label;

  return (
    <Field data-invalid={Boolean(error) || undefined} data-testid="category-icon-field">
      <input type="hidden" name={name} value={selected} />
      <FieldLabel>Icon</FieldLabel>
      <div className="flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-linear-to-br from-primary via-primary to-primary/40 text-primary-foreground ring-1 ring-border/60"
          data-testid="category-icon-current"
        >
          <Current className="size-5" aria-hidden />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onPress={() => setOpen(true)}
            data-testid="category-icon-trigger"
          >
            <PencilIcon /> {currentLabel ?? "Choose icon"}
          </Button>
          {selected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onPress={() => setSelected("")}
              data-testid="category-icon-remove"
            >
              <XIcon /> Use default
            </Button>
          )}
        </div>
      </div>
      {!selected && (
        <p className="text-xs text-muted-foreground">Default — {DEFAULT_CATEGORY_ICON_IDS.length} icons rotate</p>
      )}
      <FieldError>{error}</FieldError>

      <Dialog
        isOpen={open}
        onOpenChange={setOpen}
        className="gap-4 sm:max-w-lg"
        data-testid="category-icon-dialog"
        aria-label="Category icon"
      >
        <DialogTitle>Category icon</DialogTitle>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6" role="group" aria-label="Icons">
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
                  "relative grid aspect-square w-full place-items-center rounded-xl p-0 text-primary-foreground",
                  "bg-linear-to-br from-primary via-primary to-primary/40 hover:opacity-90",
                  isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
                )}
              >
                <Icon className="size-6" aria-hidden />
                {isSelected && (
                  <CheckIcon className="absolute right-1 bottom-1 size-3.5" aria-hidden />
                )}
              </Button>
            );
          })}
        </div>
      </Dialog>
    </Field>
  );
}
