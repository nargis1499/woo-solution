"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckSquareIcon,
  DownloadIcon,
  FolderInputIcon,
  ImagesIcon,
  RotateCcwIcon,
  SearchXIcon,
  Trash2Icon,
  UploadCloudIcon,
  UploadIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";
import { useMediaUploader } from "@/lib/media/client-upload";
import { formatBytes, mediaHref, type MediaListParams, type MediaPage, type MediaTotals } from "@/lib/media/shared";
import type { MediaFolder, MediaItem, MediaUsage } from "@/lib/types";
import { deleteMediaForever, emptyTrash, restoreMedia, trashMedia } from "@/app/nemesis/media/actions";
import { FoldersDialog } from "./folders-dialog";
import { ConfirmButton, downloadHref, triggerDownload } from "./media-bits";
import { MediaDetailDialog } from "./media-detail-dialog";
import { MediaGrid, MediaList } from "./media-grid";
import { MediaToolbar, paramsAsStrings } from "./media-toolbar";
import { MediaUploader } from "./media-uploader";
import { MoveDialog } from "./move-dialog";
import { OptimizeDialog } from "./optimize-dialog";

export type MediaLibraryProps = {
  params: MediaListParams;
  page: MediaPage;
  folders: MediaFolder[];
  totals: MediaTotals;
  usage: Record<string, MediaUsage[]>;
  aiAlt: boolean;
};

export function MediaLibrary(props: MediaLibraryProps) {
  // selection + dialogs live below a URL key so navigating resets them
  return <Library key={mediaHref(props.params)} {...props} />;
}

function Library({ params, page, folders, totals, usage, aiAlt }: MediaLibraryProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [showUploader, setShowUploader] = useState(page.total === 0 && !params.trash && !isFiltered(params));
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [optimize, setOptimize] = useState<MediaItem[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploader = useMediaUploader({
    folderId: params.folder && params.folder !== "none" ? params.folder : null,
    onSettled: (uploaded) => {
      if (uploaded.length) toast.success(`${uploaded.length} ${uploaded.length === 1 ? "file" : "files"} uploaded`);
      refresh();
    },
  });

  // page-wide drag & drop
  const { addFiles } = uploader;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (params.trash) return void toast.error("Leave the trash to upload files");
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) {
        setShowUploader(true);
        addFiles(files);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [params.trash, addFiles]);

  const items = page.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedIds = [...selected].filter((id) => byId.has(id));
  const selectedItems = selectedIds.map((id) => byId.get(id)!);
  const selectedImages = selectedItems.filter((i) => i.kind === "image" && /^image\/(png|jpe?g|webp|avif)$/.test(i.mime_type));

  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const clear = () => setSelected(new Set());

  async function bulkTrash() {
    const res = await trashMedia(selectedIds);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${res.data} ${res.data === 1 ? "file" : "files"} moved to trash`);
    clear();
    refresh();
  }
  async function bulkRestore() {
    const res = await restoreMedia(selectedIds);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${res.data} ${res.data === 1 ? "file" : "files"} restored`);
    clear();
    refresh();
  }
  async function bulkDestroy() {
    const res = await deleteMediaForever(selectedIds);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${res.data} ${res.data === 1 ? "file" : "files"} deleted permanently`);
    clear();
    refresh();
  }
  async function doEmptyTrash() {
    const res = await emptyTrash();
    if (!res.ok) return void toast.error(res.error);
    toast.success(res.data ? `Trash emptied – ${res.data} ${res.data === 1 ? "file" : "files"} deleted` : "Trash is already empty");
    clear();
    refresh();
  }

  const filtered = isFiltered(params);
  const pathname = "/nemesis/media";
  const strParams = paramsAsStrings(params);
  const usedPct = totals.library_bytes + totals.trash_bytes > 0 ? Math.round((totals.trash_bytes / (totals.library_bytes + totals.trash_bytes)) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="media-library" aria-busy={refreshing || undefined}>
      {/* drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-background/80 backdrop-blur-sm" data-testid="drop-overlay">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-12 py-10 text-center shadow-xl">
            <UploadCloudIcon className="size-12 text-primary" />
            <p className="text-lg font-semibold">Drop files to upload</p>
            <p className="text-sm text-muted-foreground">Up to 5 MB each</p>
          </div>
        </div>
      )}

      {/* totals + upload toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm" data-testid="media-totals">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span>
            <span className="font-semibold tabular-nums">{totals.library_count}</span> {totals.library_count === 1 ? "file" : "files"} ·{" "}
            <span className="font-semibold tabular-nums">{formatBytes(totals.library_bytes)}</span> in the library
          </span>
          <span className="text-muted-foreground">
            <span className="tabular-nums">{totals.trash_count}</span> in trash · <span className="tabular-nums">{formatBytes(totals.trash_bytes)}</span>
            {usedPct > 0 && ` (${usedPct}% of storage)`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {params.trash ? (
            <ConfirmButton
              label="Empty trash"
              icon={<Trash2Icon />}
              size="sm"
              isDisabled={totals.trash_count === 0}
              title={`Permanently delete ${totals.trash_count} ${totals.trash_count === 1 ? "file" : "files"}?`}
              description="Everything in the trash will be removed from storage. Products still pointing at these files lose their images. This cannot be undone."
              confirmLabel="Empty trash"
              pendingLabel="Deleting…"
              onConfirm={doEmptyTrash}
            />
          ) : (
            <Button size="sm" onPress={() => setShowUploader((v) => !v)} aria-expanded={showUploader} data-testid="toggle-uploader">
              <UploadIcon /> {showUploader ? "Hide uploader" : "Upload files"}
            </Button>
          )}
        </div>
      </div>

      {showUploader && !params.trash && <MediaUploader uploader={uploader} hint={params.folder && params.folder !== "none" ? `New files go into “${folders.find((f) => f.id === params.folder)?.name ?? "this folder"}”.` : undefined} />}

      <MediaToolbar params={params} folders={folders} trashCount={totals.trash_count} onManageFolders={() => setFoldersOpen(true)} />

      {/* collection */}
      {items.length === 0 ? (
        params.trash ? (
          <EmptyState title="Trash is empty" icon={<Trash2Icon />}>
            Files you move to the trash can be restored or deleted permanently from here.
          </EmptyState>
        ) : filtered ? (
          <EmptyState title="No files match" icon={<SearchXIcon />}>
            <p>Try another search term or clear the filters.</p>
            <Button variant="outline" size="sm" className="mt-3" onPress={() => router.push(mediaHref({ per: params.per, view: params.view }))}>
              <XIcon /> Clear filters
            </Button>
          </EmptyState>
        ) : (
          <EmptyState title="Your media library is empty" icon={<ImagesIcon />}>
            Drag files anywhere on this page or use the uploader above. Images get thumbnails automatically.
          </EmptyState>
        )
      ) : params.view === "list" ? (
        <MediaList items={items} selected={selected} onToggle={toggle} onOpen={setOpen} usage={usage} />
      ) : (
        <MediaGrid items={items} selected={selected} onToggle={toggle} onOpen={setOpen} usage={usage} />
      )}

      <Pagination pathname={pathname} params={strParams} page={page.page} perPage={page.perPage} total={page.total} itemLabel="files" />

      {/* selection bar */}
      {selectedIds.length > 0 && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-3 py-3" data-testid="bulk-actions">
          <div
            role="toolbar"
            aria-label="Selected files"
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur duration-200 animate-in fade-in-0 slide-in-from-bottom-2 supports-backdrop-filter:bg-popover/85"
          >
            <p className="whitespace-nowrap tabular-nums" aria-live="polite">
              <span className="font-semibold">{selectedIds.length}</span> selected · {formatBytes(selectedItems.reduce((s, i) => s + i.size, 0))}
            </p>
            <Separator orientation="vertical" className="mx-2 hidden sm:block" />
            {selectedIds.length < items.length && (
              <Button variant="ghost" size="sm" className="rounded-full" onPress={selectAll}>
                <CheckSquareIcon /> Select all on page
              </Button>
            )}
            <Button variant="ghost" size="sm" className="rounded-full" onPress={clear}>
              <XIcon /> Clear
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" onPress={() => triggerDownload(downloadHref(selectedIds))}>
              <DownloadIcon /> Download{selectedIds.length > 1 ? " zip" : ""}
            </Button>
            {!params.trash && (
              <>
                <Button variant="ghost" size="sm" className="rounded-full" onPress={() => setMoveOpen(true)}>
                  <FolderInputIcon /> Move
                </Button>
                {selectedImages.length > 0 && (
                  <Button variant="ghost" size="sm" className="rounded-full" onPress={() => setOptimize(selectedImages)}>
                    <WandSparklesIcon /> Optimize{selectedImages.length !== selectedIds.length ? ` (${selectedImages.length})` : ""}
                  </Button>
                )}
                <ConfirmButton
                  label="Trash"
                  icon={<Trash2Icon />}
                  className="rounded-full"
                  title={`Move ${selectedIds.length} ${selectedIds.length === 1 ? "file" : "files"} to the trash?`}
                  description="Trashed files disappear from the library and from product galleries, but can be restored until you empty the trash."
                  confirmLabel="Move to trash"
                  pendingLabel="Moving…"
                  onConfirm={bulkTrash}
                />
              </>
            )}
            {params.trash && (
              <>
                <Button variant="secondary" size="sm" className="rounded-full" onPress={bulkRestore}>
                  <RotateCcwIcon /> Restore
                </Button>
                <ConfirmButton
                  label="Delete permanently"
                  icon={<Trash2Icon />}
                  className="rounded-full"
                  title={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? "file" : "files"} permanently?`}
                  description="The files and their generated sizes are removed from storage. This cannot be undone."
                  confirmLabel="Delete permanently"
                  pendingLabel="Deleting…"
                  onConfirm={bulkDestroy}
                />
              </>
            )}
          </div>
        </div>
      )}

      {refreshing && (
        <div className="pointer-events-none fixed right-4 bottom-20 z-30 rounded-full border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow" role="status">
          <Spinner className="mr-1.5 inline size-3" /> Refreshing…
        </div>
      )}

      <MediaDetailDialog
        item={open}
        usage={open ? (usage[open.id] ?? []) : []}
        folders={folders}
        aiAlt={aiAlt}
        onOpenChange={(o) => !o && setOpen(null)}
        onChanged={(item) => {
          setOpen(item);
          refresh();
        }}
        onOptimize={(item) => setOptimize([item])}
      />
      <OptimizeDialog
        items={optimize ?? []}
        isOpen={optimize !== null}
        onOpenChange={(o) => !o && setOptimize(null)}
        onDone={(changed) => {
          if (!changed) return;
          clear();
          setOpen(null);
          refresh();
        }}
      />
      <MoveDialog
        ids={selectedIds}
        folders={folders}
        isOpen={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={() => {
          clear();
          refresh();
        }}
      />
      <FoldersDialog folders={folders} isOpen={foldersOpen} onOpenChange={setFoldersOpen} />
    </div>
  );
}

function isFiltered(p: MediaListParams) {
  return Boolean(p.q || p.kind || p.folder || p.from || p.to || p.size);
}
