"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Upload / keep / remove control for a single branding file (favicon, share
 * image …). Submits `<name>_file` (File) and `<name>_remove` ("on") – the
 * server action decides what to do from those two fields.
 */
export function MediaField({
  name,
  label,
  currentUrl,
  accept,
  error,
  shape = "square",
  removeLabel = "Remove current file",
}: {
  name: string;
  label: string;
  currentUrl: string | null;
  accept: string;
  error?: string;
  /** square = favicon-ish thumbnail, wide = 1200×630 social preview */
  shape?: "square" | "wide";
  removeLabel?: string;
}) {
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [seenUrl, setSeenUrl] = useState(currentUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = `${name}_file`;

  // A new `currentUrl` means the save went through (uploaded / removed): start from a clean slate so a
  // second save cannot re-upload the same file or remove the file that was just uploaded.
  if (seenUrl !== currentUrl) {
    setSeenUrl(currentUrl);
    setRemoving(false);
    setFilePreview(null);
  }
  useEffect(() => {
    if (fileRef.current) fileRef.current.value = "";
  }, [currentUrl]);

  // Blob URLs leak until revoked.
  useEffect(() => {
    if (!filePreview) return;
    return () => URL.revokeObjectURL(filePreview);
  }, [filePreview]);

  const previewSrc = filePreview ?? (removing ? null : currentUrl);

  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className={cn("flex gap-4", shape === "wide" ? "flex-col sm:flex-row sm:items-start" : "flex-row items-start")}>
        <div
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted text-muted-foreground",
            shape === "square" ? "size-16" : "aspect-[1.91/1] w-48",
          )}
          aria-hidden
        >
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="" className={cn("h-full w-full", shape === "square" ? "object-contain p-2" : "object-cover")} />
          ) : (
            <ImageIcon className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5 self-stretch sm:self-auto">
          <Input
            ref={fileRef}
            id={inputId}
            name={inputId}
            type="file"
            accept={accept}
            className="file:mr-3 file:rounded-sm file:bg-primary file:px-2 file:text-primary-foreground"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFilePreview(f ? URL.createObjectURL(f) : null);
              if (f) setRemoving(false);
            }}
            aria-invalid={Boolean(error) || undefined}
          />
          {currentUrl && (
            <FieldLabel htmlFor={`${name}_remove`} className="items-center text-sm font-normal text-muted-foreground">
              {/* hidden input instead of the checkbox's own `name`: survives React's post-action form reset */}
              <input type="hidden" name={`${name}_remove`} value={removing ? "on" : "off"} />
              <Checkbox id={`${name}_remove`} isSelected={removing} onChange={setRemoving} />
              {removeLabel}
            </FieldLabel>
          )}
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
