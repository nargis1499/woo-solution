"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, CheckIcon, MinusIcon, WandSparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatBytes, type OptimizeOptions } from "@/lib/media/shared";
import type { MediaItem } from "@/lib/types";
import { optimizeMedia } from "@/app/nemesis/media/actions";

type Row = { id: string; name: string; before: number; status: "pending" | "working" | "done" | "skipped" | "error"; after?: number; note?: string };

/**
 * Compress and/or convert one or many images. Files are processed one after
 * another on the server so a big batch never times out a single request; the
 * dialog shows the overall bar plus a before → after line per file.
 */
export function OptimizeDialog({
  items,
  isOpen,
  onOpenChange,
  onDone,
}: {
  items: MediaItem[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once a run finished (even partially) so the list can refresh. */
  onDone: (changed: number) => void;
}) {
  const [format, setFormat] = useState<OptimizeOptions["format"]>("keep");
  const [quality, setQuality] = useState(82);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);

  const total = items.length;
  const done = rows?.filter((r) => r.status !== "pending" && r.status !== "working").length ?? 0;
  const savedBytes = rows?.reduce((sum, r) => sum + (r.status === "done" && r.after !== undefined ? Math.max(0, r.before - r.after) : 0), 0) ?? 0;
  const finished = rows !== null && !running;

  function reset(open: boolean) {
    if (running) return;
    if (!open) setRows(null);
    onOpenChange(open);
  }

  async function run() {
    const initial: Row[] = items.map((i) => ({ id: i.id, name: i.name, before: i.size, status: "pending" }));
    setRows(initial);
    setRunning(true);
    let changed = 0;
    for (let i = 0; i < items.length; i++) {
      setRows((rs) => rs!.map((r, idx) => (idx === i ? { ...r, status: "working" } : r)));
      try {
        const res = await optimizeMedia(items[i].id, { format, quality });
        if (!res.ok) throw new Error(res.error);
        const { before, after, skipped } = res.data;
        if (!skipped) changed++;
        setRows((rs) =>
          rs!.map((r, idx) =>
            idx === i ? { ...r, status: skipped ? "skipped" : "done", before, after, note: skipped ? "Already as small as it gets" : undefined } : r,
          ),
        );
      } catch (e) {
        setRows((rs) => rs!.map((r, idx) => (idx === i ? { ...r, status: "error", note: e instanceof Error ? e.message : "Failed" } : r)));
      }
    }
    setRunning(false);
    if (changed) toast.success(`${changed} ${changed === 1 ? "image" : "images"} optimised`);
    onDone(changed);
  }

  const formatLabel = { keep: "Keep format", webp: "Convert to WebP", avif: "Convert to AVIF" }[format];

  return (
    <Dialog isOpen={isOpen} onOpenChange={reset} isDismissable={!running} className="sm:max-w-lg" data-testid="optimize-dialog">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <WandSparklesIcon className="size-5" />
          {total === 1 ? `Optimize “${items[0]?.name}”` : `Optimize ${total} images`}
        </DialogTitle>
        <DialogDescription>Re-encode with a smaller footprint and no visible quality loss. Converting changes the file extension (and therefore the URL); keeping the format does not.</DialogDescription>
      </DialogHeader>

      {rows === null ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Output format</Label>
            <ToggleGroup
              aria-label="Output format"
              variant="outline"
              spacing={0}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[format]}
              onSelectionChange={(keys) => setFormat(String([...keys][0] ?? "keep") as OptimizeOptions["format"])}
              className="w-full"
            >
              <ToggleGroupItem id="keep" className="flex-1">
                Keep
              </ToggleGroupItem>
              <ToggleGroupItem id="webp" className="flex-1">
                WebP
              </ToggleGroupItem>
              <ToggleGroupItem id="avif" className="flex-1">
                AVIF
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {format === "keep" && "PNG, JPEG, WebP and AVIF are re-compressed in place; GIF and SVG are left untouched."}
              {format === "webp" && "Best all-round choice – ~30 % smaller than JPEG, supported by every modern browser."}
              {format === "avif" && "Smallest files, slower to encode. Supported by all current browsers."}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Quality</Label>
              <span className="text-sm tabular-nums" data-testid="quality-value">
                {quality}
              </span>
            </div>
            <Slider aria-label="Quality" minValue={50} maxValue={100} step={1} value={quality} onChange={(v) => setQuality(Array.isArray(v) ? v[0] : v)} />
            <p className="text-xs text-muted-foreground">80–85 is visually lossless for photos. Lower values shrink files further.</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Total before: <span className="tabular-nums text-foreground">{formatBytes(items.reduce((s, i) => s + i.size, 0))}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Progress value={(done / Math.max(1, total)) * 100} aria-label="Optimising" className="w-full">
            <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
              <span>
                {running ? `Optimising ${Math.min(done + 1, total)} of ${total}…` : `Finished – ${formatLabel}`}
              </span>
              <span className="tabular-nums">
                {done}/{total}
              </span>
            </div>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
          <ScrollArea className="max-h-64">
            <ul className="divide-y text-sm" data-testid="optimize-rows">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1.5" data-status={r.status}>
                  <span className="grid size-5 shrink-0 place-items-center">
                    {r.status === "working" && <Spinner className="size-4" />}
                    {r.status === "done" && <CheckIcon className="size-4 text-emerald-600" />}
                    {r.status === "skipped" && <MinusIcon className="size-4 text-muted-foreground" />}
                    {r.status === "error" && <XIcon className="size-4 text-destructive" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={r.name}>
                    {r.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(r.before)}
                    {r.after !== undefined && r.status === "done" && (
                      <>
                        <ArrowRightIcon className="size-3" />
                        <span className="text-foreground">{formatBytes(r.after)}</span>
                        <span className="text-emerald-600">−{Math.round(((r.before - r.after) / Math.max(1, r.before)) * 100)}%</span>
                      </>
                    )}
                  </span>
                  {r.note && <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline" title={r.note}>{r.note}</span>}
                </li>
              ))}
            </ul>
          </ScrollArea>
          {finished && (
            <p className="text-sm" data-testid="optimize-summary">
              Saved <span className="font-medium tabular-nums">{formatBytes(savedBytes)}</span> across {rows.filter((r) => r.status === "done").length} {rows.filter((r) => r.status === "done").length === 1 ? "file" : "files"}.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        {rows === null ? (
          <>
            <DialogClose variant="outline">Cancel</DialogClose>
            <Button onPress={run} isDisabled={total === 0}>
              <WandSparklesIcon /> {format === "keep" ? "Optimize" : "Convert & optimize"}
            </Button>
          </>
        ) : (
          <Button onPress={() => reset(false)} isDisabled={running} isPending={running}>
            {running && <Spinner />}
            {running ? "Working…" : "Done"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
