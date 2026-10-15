"use client";

import { useState } from "react";
import { ImageIcon, ImagesIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { formatBytes, mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem, MediaRef } from "@/lib/types";
import { MediaPickerDialog, type MediaPickerProps } from "./media-picker";

type Mode = "keep" | "media" | "remove";

/**
 * A single Media Library reference inside any server-action form (favicon,
 * share image, …). Clicking "Choose" opens the reusable picker (library +
 * upload); the choice is submitted through two hidden inputs:
 *   <name>_mode      keep | media | remove
 *   <name>_media_id  (media) the library file id
 * The server action resolves the id to a URL – nothing else is trusted.
 */
export function MediaRefField({
  name,
  label,
  currentUrl,
  currentMedia,
  error,
  shape = "square",
  picker,
  chooseLabel = "Choose image",
  removeLabel = "Remove",
}: {
  name: string;
  label: string;
  /** URL as stored in the database (shown when the file is not a library item any more). */
  currentUrl: string | null;
  /** Library file behind `currentUrl`, when there is one. */
  currentMedia: MediaRef | null;
  error?: string;
  /** square = favicon-ish thumbnail, wide = 1200 × 630 social preview */
  shape?: "square" | "wide";
  picker: Pick<MediaPickerProps, "kind" | "accept" | "acceptFile" | "uploadFolderName" | "title" | "description" | "confirmLabel">;
  chooseLabel?: string;
  removeLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>("keep");
  const [picked, setPicked] = useState<MediaItem | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(currentUrl);

  // A new `currentUrl` means the save went through – start from a clean slate so a
  // second save cannot re-apply a stale choice.
  if (seen !== currentUrl) {
    setSeen(currentUrl);
    setMode("keep");
    setPicked(null);
  }

  const active: MediaRef | null = mode === "media" ? picked : mode === "keep" ? currentMedia : null;
  const previewUrl = mode === "remove" ? null : active ? (mediaPreviewUrl(active, shape === "wide" ? "medium" : "thumbnail") ?? mediaUrl(active.path)) : mode === "keep" ? currentUrl : null;
  const caption = active ? `${active.name}${active.width && active.height ? ` · ${active.width} × ${active.height}` : ""} · ${formatBytes(active.size)}` : previewUrl ? "Current file" : null;

  return (
    <Field data-invalid={Boolean(error) || undefined} data-testid={`media-ref-${name}`}>
      <input type="hidden" name={`${name}_mode`} value={mode} />
      <input type="hidden" name={`${name}_media_id`} value={mode === "media" ? (picked?.id ?? "") : ""} />
      <FieldLabel>{label}</FieldLabel>
      <div className={cn("flex gap-4", shape === "wide" ? "flex-col sm:flex-row sm:items-start" : "items-start")}>
        <div className={cn("relative shrink-0 overflow-hidden rounded-lg border border-dashed bg-muted", shape === "wide" ? "aspect-[1200/630] w-full sm:w-64" : "size-24")}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className={cn("h-full w-full", shape === "wide" ? "object-cover" : "object-contain p-2")} data-testid={`${name}-preview`} />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">
              <ImageIcon className="size-5" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onPress={() => setOpen(true)} data-testid={`choose-${name}`}>
              <ImagesIcon /> {previewUrl ? "Change" : chooseLabel}
            </Button>
            {previewUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setMode("remove");
                  setPicked(null);
                }}
                data-testid={`remove-${name}`}
              >
                <XIcon /> {removeLabel}
              </Button>
            )}
          </div>
          {caption && (
            <p className="truncate text-xs text-muted-foreground" title={caption}>
              {caption}
            </p>
          )}
          {mode === "remove" && <p className="text-xs text-muted-foreground">Removed – save to apply.</p>}
          <FieldError>{error}</FieldError>
        </div>
      </div>

      <MediaPickerDialog
        isOpen={open}
        onOpenChange={setOpen}
        kind="image"
        {...picker}
        onSelect={(items) => {
          if (!items[0]) return;
          setPicked(items[0]);
          setMode("media");
        }}
      />
    </Field>
  );
}
