"use client";

import { useState } from "react";
import { ImageIcon, ImagesIcon, LinkIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBytes, mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem, MediaRef } from "@/lib/types";
import { MediaPickerDialog, type MediaPickerProps } from "./media-picker";

type Mode = "keep" | "media" | "url" | "remove";

/**
 * A single Media Library reference inside any server-action form (favicon,
 * share image, page images …). Clicking "Choose" opens the reusable picker
 * (library + upload); with `allowUrl` the admin may paste a public image URL
 * instead. The choice is submitted through hidden inputs:
 *   <name>_mode      keep | media | url | remove
 *   <name>_media_id  (media) the library file id
 *   <name>_url       (url)   the external URL (a visible text input)
 * The server action resolves the id to a URL / validates the URL – nothing
 * else is trusted.
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
  allowUrl = false,
  onChange,
  extra,
  compact = false,
}: {
  compact?: boolean;
  name: string;
  label: string;
  /** URL as stored in the database (shown when the file is not a library item any more). */
  currentUrl: string | null;
  /** Library file behind `currentUrl`, when there is one. */
  currentMedia: MediaRef | null;
  error?: string;
  /** square = favicon-ish thumbnail, wide = 1200 × 630 social preview */
  shape?: "square" | "wide";
  picker: Pick<
    MediaPickerProps,
    | "kind"
    | "accept"
    | "acceptFile"
    | "uploadFolderName"
    | "title"
    | "description"
    | "confirmLabel"
  >;
  chooseLabel?: string;
  removeLabel?: string;
  /** Offer "Use a URL" next to the picker (the server action must accept `<name>_url`). */
  allowUrl?: boolean;
  /** Fired when the admin picks or removes a file (true = a file is selected). */
  onChange?: (hasImage: boolean) => void;
  /**
   * Rendered under the buttons — e.g. the matching icon picker for a category.
   * A function gets the live state of this field (`hasImage` is true whenever a
   * picture would be saved), so the extra UI can never disagree with the
   * preview right above it.
   */
  extra?: React.ReactNode | ((state: { hasImage: boolean }) => React.ReactNode);
}) {
  const external = Boolean(currentUrl && !currentMedia); // stored value is an external URL
  const [mode, setMode] = useState<Mode>("keep");
  const [picked, setPicked] = useState<MediaItem | null>(null);
  const [url, setUrl] = useState(external ? currentUrl! : "");
  const [broken, setBroken] = useState<string | null>(null); // URL whose image failed to load
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(currentUrl);

  // A new `currentUrl` means the save went through – start from a clean slate so a
  // second save cannot re-apply a stale choice.
  if (seen !== currentUrl) {
    setSeen(currentUrl);
    setMode("keep");
    setPicked(null);
    setUrl(currentUrl && !currentMedia ? currentUrl : "");
  }

  const active: MediaRef | null =
    mode === "media" ? picked : mode === "keep" ? currentMedia : null;
  const typedUrl = url.trim();
  const previewUrl =
    mode === "remove"
      ? null
      : mode === "url"
        ? typedUrl || null
        : active
          ? (mediaPreviewUrl(
              active,
              shape === "wide" ? "medium" : "thumbnail",
            ) ?? mediaUrl(active.path))
          : mode === "keep"
            ? currentUrl
            : null;
  const caption = active
    ? `${active.name}${active.width && active.height ? ` · ${active.width} × ${active.height}` : ""} · ${formatBytes(active.size)}`
    : previewUrl
      ? mode === "url" || external
        ? "External URL"
        : "Current file"
      : null;
  const showUrlInput = mode === "url" || (mode === "keep" && external);
  // What this field would save right now – the single source of truth for the
  // "Remove icon" switch under it.
  const hasImage = Boolean(previewUrl);

  if (compact)
    return (
      <Field
        data-invalid={Boolean(error) || undefined}
        data-testid={`media-ref-${name}`}
        className="min-w-0 gap-2"
      >
        <input type="hidden" name={`${name}_mode`} value={mode} />
        <input
          type="hidden"
          name={`${name}_media_id`}
          value={mode === "media" ? (picked?.id ?? "") : ""}
        />
        {!showUrlInput && <input type="hidden" name={`${name}_url`} value="" />}
        <FieldLabel className="text-xs">{label}</FieldLabel>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Choose ${label.toLowerCase()}`}
            className="grid size-9 shrink-0 place-items-center overflow-hidden rounded border border-border bg-muted text-muted-foreground"
          >
            {previewUrl && broken !== previewUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt=""
                  className="size-full object-cover"
                  onError={() => setBroken(previewUrl)}
                  data-testid={`${name}-preview`}
                />
              </>
            ) : (
              <ImageIcon className="size-4" />
            )}
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 px-2 text-xs"
            onPress={() => setOpen(true)}
            data-testid={`choose-${name}`}
          >
            {previewUrl ? "Change image" : "Choose image"}
          </Button>
          <details className="relative shrink-0">
            <summary
              className="cursor-pointer rounded border border-border px-2 py-2 text-xs"
              aria-label={`${label} options`}
            >
              ⋯
            </summary>
            <div className="absolute right-0 top-full z-30 mt-1 w-44 space-y-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
              {allowUrl && (
                <button
                  type="button"
                  className="block w-full rounded p-2 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setMode("url");
                    setPicked(null);
                    setUrl("");
                    onChange?.(false);
                  }}
                >
                  Use an image URL
                </button>
              )}
              {(previewUrl || showUrlInput) && (
                <button
                  type="button"
                  className="block w-full rounded p-2 text-left text-xs text-destructive hover:bg-muted"
                  onClick={() => {
                    setMode("remove");
                    setPicked(null);
                    setUrl("");
                    onChange?.(false);
                  }}
                >
                  Remove image
                </button>
              )}
              {!allowUrl && !previewUrl && (
                <p className="p-2 text-xs text-muted-foreground">
                  Choose an image first.
                </p>
              )}
            </div>
          </details>
        </div>
        {showUrlInput && (
          <Input
            type="url"
            name={`${name}_url`}
            value={url}
            placeholder="https://…"
            aria-label={`${label} URL`}
            onChange={(e) => {
              setUrl(e.target.value);
              setMode("url");
              onChange?.(Boolean(e.target.value.trim()));
            }}
          />
        )}
        {broken === previewUrl && previewUrl && (
          <p className="text-xs text-destructive">Image could not be loaded.</p>
        )}
        {mode === "remove" && (
          <p className="text-xs text-muted-foreground">
            Removed — save to apply.
          </p>
        )}
        <FieldError>{error}</FieldError>
        <MediaPickerDialog
          isOpen={open}
          onOpenChange={setOpen}
          kind="image"
          {...picker}
          onSelect={(items) => {
            if (!items[0]) return;
            setPicked(items[0]);
            setMode("media");
            onChange?.(true);
          }}
        />
      </Field>
    );

  return (
    <Field
      data-invalid={Boolean(error) || undefined}
      data-testid={`media-ref-${name}`}
    >
      <input type="hidden" name={`${name}_mode`} value={mode} />
      <input
        type="hidden"
        name={`${name}_media_id`}
        value={mode === "media" ? (picked?.id ?? "") : ""}
      />
      {!showUrlInput && <input type="hidden" name={`${name}_url`} value="" />}
      <FieldLabel>{label}</FieldLabel>
      {/* container query: the wide preview sits beside the buttons only when the field itself is wide enough (settings), and stacks in narrow sidebars (page form) */}
      <div
        className={cn(
          "flex gap-4 @container",
          shape === "wide"
            ? "flex-col @md:flex-row @md:items-start"
            : "items-start",
        )}
      >
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-lg border border-dashed bg-muted",
            shape === "wide" ? "aspect-[1200/630] w-full @md:w-64" : "size-24",
          )}
        >
          {previewUrl && broken !== previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className={cn(
                "h-full w-full",
                shape === "wide" ? "object-cover" : "object-contain p-2",
              )}
              onError={() => setBroken(previewUrl)}
              data-testid={`${name}-preview`}
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">
              <ImageIcon className="size-5" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onPress={() => setOpen(true)}
              data-testid={`choose-${name}`}
            >
              <ImagesIcon /> {previewUrl ? "Change" : chooseLabel}
            </Button>
            {allowUrl && !showUrlInput && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onPress={() => {
                  setMode("url");
                  setPicked(null);
                  setUrl("");
                  onChange?.(false);
                }}
                data-testid={`use-url-${name}`}
              >
                <LinkIcon /> Use a URL
              </Button>
            )}
            {(previewUrl || showUrlInput) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setMode("remove");
                  setPicked(null);
                  setUrl("");
                  onChange?.(false);
                }}
                data-testid={`remove-${name}`}
              >
                <XIcon /> {removeLabel}
              </Button>
            )}
          </div>
          {typeof extra === "function" ? extra({ hasImage }) : extra}
          {showUrlInput && (
            <Input
              type="url"
              inputMode="url"
              name={`${name}_url`}
              value={url}
              placeholder="https://example.com/image.jpg"
              aria-label={`${label} URL`}
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => {
                const next = e.target.value;
                setUrl(next);
                if (mode !== "url") setMode("url"); // editing the stored URL = a new URL choice
                onChange?.(Boolean(next.trim()));
              }}
              data-testid={`url-${name}`}
            />
          )}
          {caption && broken !== previewUrl && (
            <p
              className="truncate text-xs text-muted-foreground"
              title={caption}
            >
              {caption}
            </p>
          )}
          {previewUrl && broken === previewUrl && (
            <p className="text-xs text-destructive">
              That image could not be loaded – check the URL.
            </p>
          )}
          {mode === "remove" && (
            <p className="text-xs text-muted-foreground">
              Removed – save to apply.
            </p>
          )}
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
          onChange?.(true);
        }}
      />
    </Field>
  );
}
