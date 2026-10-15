"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { AlertCircleIcon, CheckCircle2Icon, CopyIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MAX_MEDIA_BYTES_LABEL, formatBytes } from "@/lib/media/shared";
import type { UploadEntry, useMediaUploader } from "@/lib/media/client-upload";

type Uploader = ReturnType<typeof useMediaUploader>;

/**
 * Drop zone + upload queue. Every file shows its own bar; the header shows the
 * overall progress of the batch. Duplicates wait for a decision (skip / upload
 * anyway) and never upload silently.
 */
export function MediaUploader({
  uploader,
  accept,
  hint,
  compact = false,
  className,
  duplicateSkipLabel = "Skip",
}: {
  uploader: Uploader;
  /** `accept` attribute for the file input, e.g. "image/*". */
  accept?: string;
  hint?: string;
  compact?: boolean;
  className?: string;
  /** Label of the "don't upload this duplicate" button ("Use existing" inside the picker). */
  duplicateSkipLabel?: string;
}) {
  const { entries, summary, addFiles, resolveDuplicate, resolveAllDuplicates, clearFinished } = uploader;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="media-uploader">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        data-dragging={dragging || undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/40 text-center text-sm text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-dragging:border-primary data-dragging:bg-primary/10",
          compact ? "px-4 py-6" : "px-6 py-10",
        )}
      >
        <span className="grid size-11 place-items-center rounded-full bg-background ring-1 ring-foreground/10">
          <UploadCloudIcon className="size-5 text-primary" />
        </span>
        <p className="font-medium text-foreground">
          Drag &amp; drop files here, or <span className="text-primary underline underline-offset-4">browse</span>
        </p>
        <p className="text-xs">{hint ?? `Any file type · up to ${MAX_MEDIA_BYTES_LABEL} each · several at once`}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          data-testid="media-file-input"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {entries.length > 0 && (
        <div className="rounded-xl border bg-card" data-testid="upload-queue">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <Progress value={Math.round(summary.overall * 100)} className="min-w-48 flex-1 gap-1.5" aria-label="Overall upload progress">
              <div className="flex w-full items-center justify-between text-xs">
                <ProgressLabel className="text-foreground">
                  {summary.busy ? (
                    <>
                      Uploading {summary.done + 1 > summary.total ? summary.total : summary.done + 1} of {summary.total}…
                    </>
                  ) : summary.duplicates > 0 ? (
                    `${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"} waiting for a decision`
                  ) : (
                    `${summary.done} of ${summary.total} uploaded${summary.failed ? ` · ${summary.failed} failed` : ""}`
                  )}
                </ProgressLabel>
                <ProgressValue className="tabular-nums text-muted-foreground" />
              </div>
            </Progress>
            <div className="flex items-center gap-1">
              {summary.duplicates > 1 && (
                <>
                  <Button variant="ghost" size="xs" onPress={() => resolveAllDuplicates(false)}>
                    Skip all duplicates
                  </Button>
                  <Button variant="ghost" size="xs" onPress={() => resolveAllDuplicates(true)}>
                    Upload all anyway
                  </Button>
                </>
              )}
              {!summary.busy && (
                <Button variant="ghost" size="xs" onPress={clearFinished} aria-label="Clear finished uploads">
                  <XIcon /> Clear
                </Button>
              )}
            </div>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {entries.map((entry) => (
              <UploadRow key={entry.id} entry={entry} skipLabel={duplicateSkipLabel} onDuplicate={(upload) => resolveDuplicate(entry.id, upload)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UploadRow({ entry, skipLabel, onDuplicate }: { entry: UploadEntry; skipLabel: string; onDuplicate: (upload: boolean) => void }) {
  const pct = entry.status === "done" || entry.status === "processing" ? 100 : entry.status === "uploading" ? Math.round(entry.progress * 100) : 0;
  const statusLabel: Record<UploadEntry["status"], string> = {
    hashing: "Checking…",
    duplicate: "Already in the library",
    queued: "Waiting…",
    uploading: `${pct}%`,
    processing: "Processing…",
    done: "Uploaded",
    error: "Failed",
    skipped: "Skipped",
  };
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm" data-status={entry.status} data-testid="upload-row">
      <span className="shrink-0 text-muted-foreground">
        {entry.status === "done" ? (
          <CheckCircle2Icon className="size-4 text-emerald-600" />
        ) : entry.status === "error" ? (
          <AlertCircleIcon className="size-4 text-destructive" />
        ) : entry.status === "duplicate" ? (
          <CopyIcon className="size-4 text-amber-600" />
        ) : entry.status === "skipped" ? (
          <XIcon className="size-4" />
        ) : (
          <Spinner className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium" title={entry.name}>
            {entry.name}
          </p>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatBytes(entry.size)} · {statusLabel[entry.status]}
          </p>
        </div>
        {["queued", "uploading", "processing", "hashing"].includes(entry.status) && (
          <Progress value={pct} isIndeterminate={entry.status === "processing" || entry.status === "hashing"} className="mt-1.5" aria-label={`Progress for ${entry.name}`} />
        )}
        {entry.status === "error" && <p className="mt-0.5 text-xs text-destructive">{entry.error}</p>}
        {entry.status === "duplicate" && entry.duplicateOf && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Identical to <span className="font-medium text-foreground">{entry.duplicateOf.name}</span>.
            </span>
            <Button variant="outline" size="xs" onPress={() => onDuplicate(false)}>
              {skipLabel}
            </Button>
            <Button variant="ghost" size="xs" onPress={() => onDuplicate(true)}>
              Upload anyway
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
