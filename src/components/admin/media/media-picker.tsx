"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon, LayoutGridIcon, ListIcon, SearchIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/admin/ui";
import { useMediaUploader } from "@/lib/media/client-upload";
import { pageCount } from "@/lib/admin/pagination";
import { MEDIA_KINDS, MEDIA_SORTS, mediaKindFor, type MediaPage, type MediaSort, type MediaView } from "@/lib/media/shared";
import type { MediaFolder, MediaItem, MediaKind } from "@/lib/types";
import { browseMedia, listFolders, mediaItems } from "@/app/nemesis/media/actions";
import { MediaGrid, MediaList } from "./media-grid";
import { MediaUploader } from "./media-uploader";

const PICKER_PER_PAGE = 24;

export type MediaPickerProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Allow picking several files at once. */
  multiple?: boolean;
  /** Restrict the library to one kind (e.g. "image"); uploads of other kinds are rejected too. */
  kind?: MediaKind;
  /** Files already attached – shown but not selectable again. */
  excludeIds?: string[];
  /** `accept` for the upload input (defaults to the kind, e.g. "image/*"). */
  accept?: string;
  /** Extra per-file check for uploads, e.g. "favicons must be ICO/PNG/SVG". */
  acceptFile?: (file: File) => string | null;
  /** Uploads made from the picker are filed under this folder (created on first use). */
  uploadFolderName?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onSelect: (items: MediaItem[]) => void;
};

/**
 * Reusable "Select from Media Library" modal. Any admin form can mount it;
 * it browses the same library as the Media page (search, type / folder
 * filters, sort, grid / list) and has an Upload tab whose files are
 * selected automatically once they finish.
 */
export function MediaPickerDialog(props: MediaPickerProps) {
  // Everything inside resets when the dialog is reopened.
  return props.isOpen ? <PickerBody key="open" {...props} /> : null;
}

function PickerBody({ isOpen, onOpenChange, multiple = false, kind, excludeIds = [], accept, acceptFile, uploadFolderName, title, description, confirmLabel, onSelect }: MediaPickerProps) {
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MediaKind | "">(kind ?? "");
  const [folder, setFolder] = useState("");
  const [sort, setSort] = useState<MediaSort>("date_desc");
  const [view, setView] = useState<MediaView>("grid");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MediaPage | null>(null);
  const [loading, startLoad] = useTransition();
  const [reloadTick, setReloadTick] = useState(0);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [selected, setSelected] = useState<Map<string, MediaItem>>(() => new Map());
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const reqSeq = useRef(0);

  useEffect(() => {
    const seq = ++reqSeq.current;
    startLoad(async () => {
      const res = await browseMedia({
        q: query,
        kind: kind ?? kindFilter,
        folder,
        sort,
        page: String(page),
        per: String(PICKER_PER_PAGE),
      });
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      if (!res.ok) return void toast.error(res.error);
      setData(res.data);
    });
  }, [query, kind, kindFilter, folder, sort, page, reloadTick]);
  const load = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    listFolders().then((res) => res.ok && setFolders(res.data));
  }, []);

  const uploader = useMediaUploader({
    folderId: folder && folder !== "none" ? folder : null,
    folderName: uploadFolderName ?? null,
    accept: (file) => {
      if (kind && mediaKindFor(file.type, file.name) !== kind) return `Only ${kind}s can be added here.`;
      return acceptFile?.(file) ?? null;
    },
    onUploaded: (item) => {
      setSelected((prev) => {
        const next = multiple ? new Map(prev) : new Map<string, MediaItem>();
        next.set(item.id, item);
        return next;
      });
    },
    onSettled: (uploaded) => {
      if (uploaded.length) {
        toast.success(`${uploaded.length} ${uploaded.length === 1 ? "file" : "files"} uploaded and selected`);
        setTab("library");
        setPage(1);
        setSort("date_desc");
        load();
      }
    },
    // the same bytes are already in the library → select that file instead of storing a copy
    onSkipDuplicate: (existing) => {
      startLoad(async () => {
        const res = await mediaItems([existing.id]);
        const item = res.ok ? res.data[0] : undefined;
        if (!item) return void toast.error("The existing file could not be loaded.");
        setSelected((prev) => {
          const next = multiple ? new Map(prev) : new Map<string, MediaItem>();
          next.set(item.id, item);
          return next;
        });
        toast.success(`Selected the existing file “${item.name}”`);
        setTab("library");
      });
    },
  });

  function pick(item: MediaItem) {
    if (excluded.has(item.id)) return;
    setSelected((prev) => {
      if (!multiple) return prev.has(item.id) ? new Map() : new Map([[item.id, item]]);
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }
  function toggle(id: string, on: boolean) {
    const item = data?.items.find((i) => i.id === id);
    if (!item || excluded.has(id)) return;
    setSelected((prev) => {
      if (!multiple) return on ? new Map([[id, item]]) : new Map();
      const next = new Map(prev);
      if (on) next.set(id, item);
      else next.delete(id);
      return next;
    });
  }

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const items = data?.items ?? [];
  const pages = data ? pageCount(data.total, data.perPage) : 1;
  const count = selected.size;

  function confirm() {
    if (count === 0) return;
    onSelect([...selected.values()]);
    onOpenChange(false);
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-5xl" data-testid="media-picker" isDismissable={!uploader.summary.busy}>
      <DialogHeader>
        <DialogTitle>{title ?? (multiple ? "Add from Media Library" : "Choose a file")}</DialogTitle>
        <DialogDescription>{description ?? (kind === "image" ? "Pick an image from the library or upload a new one. Uploads are stored in the Media Library so you can reuse them." : "Pick from the library or upload new files.")}</DialogDescription>
      </DialogHeader>

      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as "library" | "upload")} className="gap-3">
        <TabsList aria-label="Source">
          <TabsTrigger id="library">Media Library</TabsTrigger>
          <TabsTrigger id="upload">
            <UploadIcon /> Upload new
          </TabsTrigger>
        </TabsList>

        <TabsContent id="library" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                // The dialog is portalled, but React still bubbles this submit to the
                // *host* form (page / settings form) – it must not save that one.
                e.stopPropagation();
                setPage(1);
                setQuery(q.trim());
              }}
            >
              <InputGroup className="w-48 sm:w-60">
                <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" aria-label="Search files" />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
              </InputGroup>
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
            </form>
            {!kind && (
              <Select aria-label="File type" selectedKey={kindFilter || "all"} onSelectionChange={(k) => { setPage(1); setKindFilter(k === "all" ? "" : (String(k) as MediaKind)); }}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem id="all">All types</SelectItem>
                  {MEDIA_KINDS.map((k) => (
                    <SelectItem key={k.id} id={k.id}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select aria-label="Folder" selectedKey={folder || "all"} onSelectionChange={(k) => { setPage(1); setFolder(k === "all" ? "" : String(k)); }}>
              <SelectTrigger className="h-8 w-40">
                <FolderIcon className="text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="all">All folders</SelectItem>
                <SelectItem id="none">Unfiled</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} id={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <Select aria-label="Sort by" selectedKey={sort} onSelectionChange={(k) => { setPage(1); setSort(String(k) as MediaSort); }}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_SORTS.map((s) => (
                    <SelectItem key={s.id} id={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToggleGroup aria-label="View" variant="outline" size="sm" spacing={0} selectionMode="single" disallowEmptySelection selectedKeys={[view]} onSelectionChange={(keys) => setView(String([...keys][0] ?? "grid") as MediaView)}>
                <ToggleGroupItem id="grid" aria-label="Grid view">
                  <LayoutGridIcon />
                </ToggleGroupItem>
                <ToggleGroupItem id="list" aria-label="List view">
                  <ListIcon />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <div className="relative max-h-[52vh] min-h-[240px] overflow-y-auto rounded-lg border bg-muted/30 p-3" aria-busy={loading || undefined}>
            {loading && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-background/60">
                <Spinner />
              </div>
            )}
            {data && items.length === 0 ? (
              <EmptyState title={query || folder ? "No files match" : "Nothing here yet"}>
                {query || folder ? "Try another search or folder." : "Switch to “Upload new” to add the first file."}
              </EmptyState>
            ) : view === "list" ? (
              <MediaList items={items} selected={selectedIds} onToggle={toggle} onOpen={pick} compact readOnly disabledIds={excluded} />
            ) : (
              <MediaGrid items={items} selected={selectedIds} onToggle={toggle} onOpen={pick} compact readOnly disabledIds={excluded} />
            )}
          </div>

          {data && data.total > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {data.total} {data.total === 1 ? "file" : "files"}
                {excluded.size > 0 && " · already attached files are greyed out"}
              </span>
              {pages > 1 && (
                <span className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Previous page" isDisabled={page <= 1 || loading} onPress={() => setPage((p) => p - 1)}>
                    <ChevronLeftIcon />
                  </Button>
                  <span className="tabular-nums">
                    Page {data.page} of {pages}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label="Next page" isDisabled={page >= pages || loading} onPress={() => setPage((p) => p + 1)}>
                    <ChevronRightIcon />
                  </Button>
                </span>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent id="upload">
          <MediaUploader
            uploader={uploader}
            duplicateSkipLabel="Use existing"
            accept={accept ?? (kind === "image" ? "image/*" : kind === "video" ? "video/*" : undefined)}
            hint={uploadFolderName ? `Files land in the “${uploadFolderName}” folder of the Media Library.` : kind === "image" ? "JPEG, PNG, WebP, GIF, AVIF or SVG · max 5 MB each. Thumbnails are generated automatically." : undefined}
            compact
          />
        </TabsContent>
      </Tabs>

      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-muted-foreground" aria-live="polite" data-testid="picker-count">
          {count === 0 ? "Nothing selected" : `${count} selected`}
        </span>
        <DialogClose variant="outline">Cancel</DialogClose>
        <Button onPress={confirm} isDisabled={count === 0} data-testid="picker-confirm">
          {confirmLabel ?? (multiple ? `Add ${count || ""} ${count === 1 ? "file" : "files"}`.replace(/\s+/g, " ") : "Use this file")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
