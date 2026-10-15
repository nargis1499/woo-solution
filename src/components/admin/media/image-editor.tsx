"use client";

import { useEffect, useMemo, useState } from "react";
import ReactCrop, { type Crop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { CropIcon, FlipHorizontal2Icon, FlipVertical2Icon, RotateCcwIcon, RotateCwIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { mediaUrl, type EditOps } from "@/lib/media/shared";
import type { MediaItem } from "@/lib/types";

const ASPECTS: { id: string; label: string; value?: number }[] = [
  { id: "free", label: "Free crop" },
  { id: "1", label: "Square 1:1", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:2", label: "3:2", value: 3 / 2 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
];

/**
 * Crop / rotate / flip. The preview is drawn on a canvas with flips applied
 * before the rotation – the same canonical order sharp uses on the server, so
 * what you see is exactly what gets saved. Crop coordinates are percentages of
 * that transformed preview.
 */
export function ImageEditor({
  item,
  busy,
  onApply,
  onCancel,
}: {
  item: MediaItem;
  busy: boolean;
  onApply: (ops: EditOps, mode: "replace" | "copy") => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<Crop | undefined>();
  const [aspectId, setAspectId] = useState("free");
  const aspect = ASPECTS.find((a) => a.id === aspectId)?.value;

  // load the original once (CORS-enabled so the canvas stays exportable)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setSource(img);
    img.onerror = () => setLoadError("The image could not be loaded for editing.");
    img.src = `${mediaUrl(item.path)}?v=${encodeURIComponent(item.updated_at)}`;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [item.path, item.updated_at]);

  // transformed preview (downscaled for speed – the server works on the original pixels)
  const preview = useMemo(() => {
    if (!source) return null;
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(source.naturalWidth, source.naturalHeight));
    const w = Math.max(1, Math.round(source.naturalWidth * scale));
    const h = Math.max(1, Math.round(source.naturalHeight * scale));
    const swap = rotate === 90 || rotate === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    try {
      return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    } catch {
      return null;
    }
  }, [source, rotate, flipH, flipV]);

  const rotated = rotate === 90 || rotate === 270;
  const turn = (delta: 90 | -90) => {
    setRotate(((rotate + delta + 360) % 360) as 0 | 90 | 180 | 270);
    setCrop(undefined);
  };
  // a flip of the *displayed* (rotated) image is a flip of the other axis before rotation
  const flipHorizontal = () => {
    if (rotated) setFlipV((v) => !v);
    else setFlipH((v) => !v);
    setCrop(undefined);
  };
  const flipVertical = () => {
    if (rotated) setFlipH((v) => !v);
    else setFlipV((v) => !v);
    setCrop(undefined);
  };
  const reset = () => {
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
    setCrop(undefined);
    setAspectId("free");
  };

  const pct = crop && crop.unit === "%" && crop.width > 0 && crop.height > 0 ? (crop as PercentCrop) : null;
  const hasCrop = Boolean(pct && (pct.width < 99.9 || pct.height < 99.9 || pct.x > 0.1 || pct.y > 0.1));
  const dirty = rotate !== 0 || flipH || flipV || hasCrop;
  const ops = (): EditOps => ({
    rotate,
    flipH,
    flipV,
    crop: hasCrop && pct ? { x: pct.x, y: pct.y, width: pct.width, height: pct.height } : null,
  });

  const tw = rotated ? item.height : item.width;
  const th = rotated ? item.width : item.height;
  const outW = tw ? Math.round((tw * (hasCrop && pct ? pct.width : 100)) / 100) : null;
  const outH = th ? Math.round((th * (hasCrop && pct ? pct.height : 100)) / 100) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]" data-testid="image-editor">
      <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-3">
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : preview ? (
          <ReactCrop crop={crop} onChange={(_px, percent) => setCrop(percent)} aspect={aspect} keepSelection className="max-h-[60vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.src} alt="" className="max-h-[60vh] w-auto max-w-full object-contain" draggable={false} />
          </ReactCrop>
        ) : (
          <Spinner />
        )}
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-2 font-medium">Rotate &amp; flip</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onPress={() => turn(-90)} isDisabled={!preview || busy}>
              <RotateCcwIcon /> Left
            </Button>
            <Button variant="outline" onPress={() => turn(90)} isDisabled={!preview || busy}>
              <RotateCwIcon /> Right
            </Button>
            <Button variant="outline" onPress={flipHorizontal} isDisabled={!preview || busy} aria-pressed={rotated ? flipV : flipH}>
              <FlipHorizontal2Icon /> Flip H
            </Button>
            <Button variant="outline" onPress={flipVertical} isDisabled={!preview || busy} aria-pressed={rotated ? flipH : flipV}>
              <FlipVertical2Icon /> Flip V
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 font-medium">
            <CropIcon className="size-4" /> Crop
          </p>
          <Select aria-label="Crop aspect ratio" selectedKey={aspectId} onSelectionChange={(k) => { setAspectId(String(k)); setCrop(undefined); }} isDisabled={!preview || busy}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECTS.map((a) => (
                <SelectItem key={a.id} id={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">Drag on the picture to pick the area to keep. {hasCrop ? "" : "No crop yet – the whole image is kept."}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Original</dt>
          <dd className="tabular-nums">{item.width && item.height ? `${item.width} × ${item.height}` : "–"}</dd>
          <dt>Result</dt>
          <dd className="tabular-nums" data-testid="editor-result-size">
            {outW && outH ? `${outW} × ${outH}` : "–"}
          </dd>
        </dl>
        <div className="flex flex-col gap-2 pt-2">
          <Button onPress={() => onApply(ops(), "replace")} isDisabled={!dirty || busy} isPending={busy}>
            {busy && <Spinner />}
            Apply to this file
          </Button>
          <Button variant="secondary" onPress={() => onApply(ops(), "copy")} isDisabled={!dirty || busy}>
            Save as a copy
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onPress={reset} isDisabled={!dirty || busy}>
              <Undo2Icon /> Reset
            </Button>
            <Button variant="outline" className="flex-1" onPress={onCancel} isDisabled={busy}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">“Apply” overwrites the file and keeps its URL; “Save as a copy” adds a new file next to it.</p>
        </div>
      </div>
    </div>
  );
}
