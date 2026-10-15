"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckIcon,
  CopyIcon,
  CropIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { uploadToStorage } from "@/lib/media/client-upload";
import { MAX_MEDIA_BYTES, formatBytes, formatLabel, isEditableImage, mediaPreviewUrl, mediaUrl, validateMediaFile } from "@/lib/media/shared";
import type { EditOps } from "@/lib/media/shared";
import type { MediaFolder, MediaItem, MediaUsage } from "@/lib/types";
import {
  deleteMediaForever,
  editMedia,
  finalizeReplace,
  moveMedia,
  prepareReplace,
  renameMedia,
  restoreMedia,
  suggestAltText,
  trashMedia,
  updateMediaAlt,
} from "@/app/nemesis/media/actions";
import { ImageEditor } from "./image-editor";
import { ConfirmButton, FileTypeIcon, USAGE_ROLE_LABEL, dimensionsOf, downloadHref, isPageUsage, triggerDownload, useCopy, usageHref, usageLabel } from "./media-bits";

export function MediaDetailDialog({
  item,
  usage,
  folders,
  aiAlt,
  onOpenChange,
  onChanged,
  onOptimize,
}: {
  item: MediaItem | null;
  usage: MediaUsage[];
  folders: MediaFolder[];
  aiAlt: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = the file left the current list (trashed / restored / deleted). */
  onChanged: (item: MediaItem | null) => void;
  onOptimize: (item: MediaItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // reset the editor whenever another file is opened
  const lastId = useRef<string | null>(null);
  if (item?.id !== lastId.current) {
    lastId.current = item?.id ?? null;
    if (editing) setEditing(false);
  }

  const isImage = item ? isEditableImage(item.mime_type) : false;
  const inTrash = Boolean(item?.deleted_at);

  async function applyEdit(ops: EditOps, mode: "replace" | "copy") {
    if (!item) return;
    setBusy(true);
    const res = await editMedia(item.id, ops, mode);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(mode === "copy" ? `Saved as “${res.data.name}”` : "Image updated");
    setEditing(false);
    onChanged(mode === "copy" ? item : res.data);
  }

  return (
    <Dialog isOpen={Boolean(item)} onOpenChange={onOpenChange} isDismissable={!busy} className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-5xl" data-testid="media-detail">
      {item && (
        <>
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2 truncate">
              <span className="truncate">{item.name}</span>
              {inTrash && <Badge variant="destructive">In trash</Badge>}
            </DialogTitle>
            <DialogDescription>
              {formatLabel(item.mime_type, item.name)} · {formatBytes(item.size)}
              {dimensionsOf(item) ? ` · ${dimensionsOf(item)}` : ""}
            </DialogDescription>
          </DialogHeader>

          {editing && isImage ? (
            <ImageEditor key={item.id + item.updated_at} item={item} busy={busy} onApply={applyEdit} onCancel={() => setEditing(false)} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)]">
              <Preview item={item} />
              <Details
                key={item.id + item.updated_at}
                item={item}
                usage={usage}
                folders={folders}
                aiAlt={aiAlt}
                inTrash={inTrash}
                busy={busy}
                setBusy={setBusy}
                onChanged={onChanged}
                onEdit={isImage ? () => setEditing(true) : undefined}
                onOptimize={isImage ? () => onOptimize(item) : undefined}
              />
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/* ─── Preview ─────────────────────────────────────────────────────────────── */

function Preview({ item }: { item: MediaItem }) {
  const url = mediaUrl(item.path);
  const bust = `?v=${encodeURIComponent(item.updated_at)}`;
  const m = item.mime_type;
  return (
    <div className="grid min-h-[280px] place-items-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-3" data-testid="media-preview">
      {item.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaPreviewUrl(item, "large") ?? mediaUrl(item.path)} alt={item.alt ?? ""} className="max-h-[60vh] w-auto max-w-full rounded object-contain" />
      ) : m.startsWith("video/") ? (
        <video src={url + bust} controls className="max-h-[60vh] w-full rounded bg-black" />
      ) : m.startsWith("audio/") ? (
        <div className="w-full space-y-4 text-center">
          <FileTypeIcon mime={m} name={item.name} className="mx-auto size-16 text-muted-foreground" />
          <audio src={url + bust} controls className="w-full" />
        </div>
      ) : m === "application/pdf" ? (
        <iframe src={url + bust} title={item.name} className="h-[60vh] w-full rounded bg-white" />
      ) : (
        <div className="text-center text-muted-foreground">
          <FileTypeIcon mime={m} name={item.name} className="mx-auto size-20" />
          <p className="mt-3 text-sm">No preview for this file type.</p>
          <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
            Open in a new tab <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}

/* ─── Details / actions column ────────────────────────────────────────────── */

function Details({
  item,
  usage,
  folders,
  aiAlt,
  inTrash,
  busy,
  setBusy,
  onChanged,
  onEdit,
  onOptimize,
}: {
  item: MediaItem;
  usage: MediaUsage[];
  folders: MediaFolder[];
  aiAlt: boolean;
  inTrash: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: (item: MediaItem | null) => void;
  onEdit?: () => void;
  onOptimize?: () => void;
}) {
  const url = mediaUrl(item.path);
  const { copied, copy } = useCopy();
  const [name, setName] = useState(item.name);
  const [alt, setAlt] = useState(item.alt ?? "");
  const [savingName, startName] = useTransition();
  const [savingAlt, startAlt] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const [moving, startMove] = useTransition();
  const [acting, startAct] = useTransition();
  const [replace, setReplace] = useState<{ progress: number; label: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setBusy(Boolean(replace)), [replace, setBusy]);

  function saveName() {
    const next = name.trim();
    if (!next || next === item.name) return;
    startName(async () => {
      const res = await renameMedia(item.id, next);
      if (!res.ok) return void toast.error(res.error);
      toast.success("File renamed");
      onChanged(res.data);
    });
  }

  function saveAlt() {
    if (alt === (item.alt ?? "")) return;
    startAlt(async () => {
      const res = await updateMediaAlt(item.id, alt);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Alt text saved");
      onChanged(res.data);
    });
  }

  function suggest() {
    startSuggest(async () => {
      const res = await suggestAltText(item.id);
      if (!res.ok) return void toast.error(res.error);
      setAlt(res.data);
      toast.success("Suggestion ready – review it and save");
    });
  }

  function move(folderId: string | null) {
    startMove(async () => {
      const res = await moveMedia([item.id], folderId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(folderId ? "Moved to folder" : "Removed from folder");
      onChanged({ ...item, folder_id: folderId });
    });
  }

  async function replaceWith(file: File) {
    const problem = validateMediaFile(file);
    if (problem) return void toast.error(problem);
    setReplace({ progress: 0, label: "Preparing…" });
    try {
      const prep = await prepareReplace(item.id, { name: file.name, size: file.size, type: file.type });
      if (!prep.ok) throw new Error(prep.error);
      setReplace({ progress: 0, label: "Uploading…" });
      await uploadToStorage({
        path: prep.data.path,
        file,
        contentType: file.type || item.mime_type,
        token: prep.data.token,
        upsert: true,
        onProgress: (p) => setReplace({ progress: p, label: "Uploading…" }),
      });
      setReplace({ progress: 100, label: "Finishing…" });
      const fin = await finalizeReplace(item.id);
      if (!fin.ok) throw new Error(fin.error);
      toast.success("File replaced – the URL stays the same");
      onChanged(fin.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setReplace(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function trash() {
    startAct(async () => {
      const res = await trashMedia([item.id]);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Moved to trash");
      onChanged(null);
    });
  }
  function restore() {
    startAct(async () => {
      const res = await restoreMedia([item.id]);
      if (!res.ok) return void toast.error(res.error);
      toast.success("File restored");
      onChanged(null);
    });
  }
  async function destroy() {
    const res = await deleteMediaForever([item.id]);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Deleted permanently");
    onChanged(null);
  }

  const variantsBytes = item.variants_size ?? 0;
  const uses = usageLabel(usage);

  return (
    <div className="min-w-0 space-y-5 text-sm">
      {/* name */}
      <div className="space-y-1.5">
        <Label htmlFor="media-name">File name</Label>
        <div className="flex gap-2">
          <Input id="media-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} disabled={inTrash || savingName} />
          <Button variant="outline" onPress={saveName} isDisabled={inTrash || savingName || !name.trim() || name.trim() === item.name} isPending={savingName}>
            {savingName ? <Spinner /> : <PencilIcon />}
            Rename
          </Button>
        </div>
      </div>

      {/* alt text */}
      {item.kind === "image" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="media-alt">Alt text</Label>
            {aiAlt && (
              <Button variant="ghost" size="xs" onPress={suggest} isDisabled={inTrash || suggesting} isPending={suggesting}>
                {suggesting ? <Spinner /> : <SparklesIcon />}
                Suggest with AI
              </Button>
            )}
          </div>
          <Textarea id="media-alt" value={alt} onChange={(e) => setAlt(e.target.value)} rows={2} placeholder="Describe the image for screen readers and SEO" disabled={inTrash || savingAlt} />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onPress={saveAlt} isDisabled={inTrash || savingAlt || alt === (item.alt ?? "")} isPending={savingAlt}>
              {savingAlt && <Spinner />}
              Save alt text
            </Button>
          </div>
        </div>
      )}

      {/* folder */}
      <div className="space-y-1.5">
        <Label htmlFor="media-folder">Folder</Label>
        <Select id="media-folder" aria-label="Folder" selectedKey={item.folder_id ?? "none"} onSelectionChange={(k) => move(k === "none" ? null : String(k))} isDisabled={inTrash || moving}>
          <SelectTrigger className="w-full">
            <FolderIcon className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="none">No folder</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} id={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* facts */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted-foreground">
        <dt>Type</dt>
        <dd className="text-foreground">{formatLabel(item.mime_type, item.name)}</dd>
        <dt>Size</dt>
        <dd className="text-foreground tabular-nums">
          {formatBytes(item.size)}
          {variantsBytes > 0 && <span className="text-muted-foreground"> (+ {formatBytes(variantsBytes)} thumbnails)</span>}
        </dd>
        {dimensionsOf(item) && (
          <>
            <dt>Dimensions</dt>
            <dd className="text-foreground tabular-nums">{dimensionsOf(item)} px</dd>
          </>
        )}
        <dt>Uploaded</dt>
        <dd className="text-foreground">{new Date(item.created_at).toLocaleString()}</dd>
        {item.updated_at !== item.created_at && (
          <>
            <dt>Modified</dt>
            <dd className="text-foreground">{new Date(item.updated_at).toLocaleString()}</dd>
          </>
        )}
        <dt>Used in</dt>
        <dd className="text-foreground" data-testid="media-usage">
          {usage.length === 0 ? (
            "Not used yet"
          ) : (
            <span className="space-y-0.5">
              <span className="block">{uses?.replace("Used in ", "")}</span>
              {usage.map((u) =>
                u.product_id ? (
                  <Link key={`${u.product_id}-${u.role}`} href={usageHref(u)} className="block truncate text-primary underline-offset-4 hover:underline">
                    {u.product_name} <span className="text-muted-foreground">({isPageUsage(u) ? `page · ${USAGE_ROLE_LABEL[u.role]}` : USAGE_ROLE_LABEL[u.role]})</span>
                  </Link>
                ) : (
                  <Link key={u.role} href={usageHref(u)} className="block truncate text-primary underline-offset-4 hover:underline">
                    {USAGE_ROLE_LABEL[u.role]} <span className="text-muted-foreground">(Settings)</span>
                  </Link>
                ),
              )}
            </span>
          )}
        </dd>
      </dl>

      {/* url */}
      <div className="space-y-1.5">
        <Label htmlFor="media-url">File URL</Label>
        <div className="flex gap-2">
          <Input id="media-url" value={url} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button variant="outline" onPress={() => copy(url)} aria-label="Copy URL">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {/* replace progress */}
      {replace && (
        <Progress value={replace.progress} aria-label="Replacing file" className="w-full">
          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span>{replace.label}</span>
            <span className="tabular-nums">{replace.progress}%</span>
          </div>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      )}

      {/* actions */}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" size="sm" onPress={() => triggerDownload(downloadHref([item.id]))}>
          <DownloadIcon /> Download
        </Button>
        {!inTrash && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept={item.kind === "image" ? "image/*" : undefined}
              data-testid="replace-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void replaceWith(f);
              }}
            />
            <Button variant="outline" size="sm" onPress={() => fileRef.current?.click()} isDisabled={busy}>
              <RefreshCwIcon /> Replace file
            </Button>
            {onEdit && (
              <Button variant="outline" size="sm" onPress={onEdit} isDisabled={busy}>
                <CropIcon /> Edit image
              </Button>
            )}
            {onOptimize && (
              <Button variant="outline" size="sm" onPress={onOptimize} isDisabled={busy}>
                <WandSparklesIcon /> Optimize
              </Button>
            )}
            <Button variant="destructive" size="sm" className="ml-auto" onPress={trash} isDisabled={busy || acting} isPending={acting}>
              {acting ? <Spinner /> : <Trash2Icon />}
              Move to trash
            </Button>
          </>
        )}
        {inTrash && (
          <>
            <Button variant="secondary" size="sm" onPress={restore} isDisabled={acting} isPending={acting}>
              {acting ? <Spinner /> : <RotateCcwIcon />}
              Restore
            </Button>
            <ConfirmButton
              className="ml-auto"
              label="Delete permanently"
              icon={<Trash2Icon />}
              title="Delete this file permanently?"
              description={
                <>
                  “{item.name}” and its generated sizes will be removed from storage. This cannot be undone.
                  {usage.length > 0 && <> It is still {uses?.toLowerCase()} – those references will be cleared.</>}
                </>
              }
              confirmLabel="Delete permanently"
              pendingLabel="Deleting…"
              onConfirm={destroy}
            />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Max file size {formatBytes(MAX_MEDIA_BYTES)}. Replacing keeps the same URL; renaming only changes the display name.</p>
    </div>
  );
}
