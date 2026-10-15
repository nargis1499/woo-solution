"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog as AriaDialog } from "react-aria-components";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { CalendarIcon, FolderIcon, LayoutGridIcon, ListIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RangeCalendar } from "@/components/ui/calendar";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PerPageSelect } from "@/components/admin/per-page-select";
import { cn } from "@/lib/utils";
import {
  MEDIA_KINDS,
  MEDIA_PAGE_SIZES,
  MEDIA_PER_PAGE_COOKIE,
  MEDIA_SIZE_PRESETS,
  MEDIA_SORTS,
  MEDIA_VIEW_COOKIE,
  mediaHref,
  type MediaListParams,
  type MediaView,
} from "@/lib/media/shared";
import type { MediaFolder } from "@/lib/types";

/** Plain string version of the params for the shared pagination / per-page helpers. */
export function paramsAsStrings(p: MediaListParams): Record<string, string | undefined> {
  return {
    trash: p.trash ? "1" : undefined,
    q: p.q || undefined,
    kind: p.kind || undefined,
    folder: p.folder || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
    size: p.size || undefined,
    sort: p.sort !== "date_desc" ? p.sort : undefined,
    view: p.view !== "grid" ? p.view : undefined,
  };
}

export function MediaToolbar({
  params,
  folders,
  trashCount,
  onManageFolders,
}: {
  params: MediaListParams;
  folders: MediaFolder[];
  trashCount: number;
  onManageFolders: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q);

  function go(next: Partial<MediaListParams>, resetPage = true) {
    startTransition(() => router.push(mediaHref({ ...params, ...next, page: resetPage ? 1 : (next.page ?? params.page) })));
  }

  const isFiltered = Boolean(params.q || params.kind || params.folder || params.from || params.to || params.size);
  const dateLabel = params.from && params.to ? `${params.from} – ${params.to}` : params.from ? `From ${params.from}` : params.to ? `Until ${params.to}` : "Any date";

  return (
    <div className="space-y-3" data-testid="media-toolbar" aria-busy={pending || undefined}>
      {/* row 1 – search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <InputGroup className="w-56 sm:w-64">
            <InputGroupInput type="search" name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" aria-label="Search files" />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <Select aria-label="File type" selectedKey={params.kind || "all"} onSelectionChange={(k) => go({ kind: k === "all" ? "" : (String(k) as MediaListParams["kind"]) })}>
          <SelectTrigger className="w-36">
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

        <Select aria-label="Folder" selectedKey={params.folder || "all"} onSelectionChange={(k) => go({ folder: k === "all" ? "" : String(k) })}>
          <SelectTrigger className="w-44">
            <FolderIcon className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="all">All folders</SelectItem>
            <SelectItem id="none">Unfiled</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} id={f.id} textValue={f.name}>
                {f.name}
                {typeof f.file_count === "number" && <span className="ml-auto pl-3 text-xs text-muted-foreground">{f.file_count}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangeFilter from={params.from} to={params.to} label={dateLabel} onChange={(from, to) => go({ from, to })} />

        <Select aria-label="File size" selectedKey={params.size || "any"} onSelectionChange={(k) => go({ size: k === "any" ? "" : (String(k) as MediaListParams["size"]) })}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEDIA_SIZE_PRESETS.map((p) => (
              <SelectItem key={p.id || "any"} id={p.id || "any"}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isFiltered && (
          <Button
            variant="ghost"
            onPress={() => {
              setQ("");
              go({ q: "", kind: "", folder: "", from: "", to: "", size: "" });
            }}
          >
            <XIcon /> Clear filters
          </Button>
        )}
      </div>

      {/* row 2 – folders / trash on the left, sort / view / page size on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onPress={onManageFolders}>
          <FolderIcon /> Folders
        </Button>
        <Button variant={params.trash ? "secondary" : "outline"} onPress={() => go({ trash: !params.trash })} aria-pressed={params.trash} data-testid="trash-toggle">
          <Trash2Icon /> Trash
          <span className={cn("rounded-full px-1.5 text-xs tabular-nums", trashCount ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{trashCount}</span>
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select aria-label="Sort by" selectedKey={params.sort} onSelectionChange={(k) => go({ sort: String(k) as MediaListParams["sort"] })}>
            <SelectTrigger className="w-40">
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
          <ToggleGroup
            aria-label="View"
            variant="outline"
            spacing={0}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[params.view]}
            onSelectionChange={(keys) => {
              const view = String([...keys][0] ?? "grid") as MediaView;
              document.cookie = `${MEDIA_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
              go({ view }, false);
            }}
          >
            <ToggleGroupItem id="grid" aria-label="Grid view">
              <LayoutGridIcon />
            </ToggleGroupItem>
            <ToggleGroupItem id="list" aria-label="List view">
              <ListIcon />
            </ToggleGroupItem>
          </ToggleGroup>
          <PerPageSelect pathname="/nemesis/media" params={paramsAsStrings(params)} page={params.page} perPage={params.per} options={MEDIA_PAGE_SIZES} cookieName={MEDIA_PER_PAGE_COOKIE} label="Show" />
        </div>
      </div>
    </div>
  );
}

function DateRangeFilter({ from, to, label, onChange }: { from: string; to: string; label: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const value = from && to ? { start: parseDate(from), end: parseDate(to) } : null;
  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="outline" className={cn("w-44 justify-start font-normal", !(from || to) && "text-muted-foreground")} aria-label="Upload date">
        <CalendarIcon className="text-muted-foreground" />
        <span className="truncate">{label}</span>
      </Button>
      <Popover className="w-auto p-2">
        <AriaDialog aria-label="Upload date range" className="outline-none">
          <RangeCalendar<CalendarDate>
            aria-label="Upload date"
            value={value}
            onChange={(range) => {
              if (!range) return;
              onChange(range.start.toString(), range.end.toString());
              setOpen(false);
            }}
          />
          {(from || to) && (
            <div className="flex justify-end border-t px-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  onChange("", "");
                  setOpen(false);
                }}
              >
                <XIcon /> Clear dates
              </Button>
            </div>
          )}
        </AriaDialog>
      </Popover>
    </PopoverTrigger>
  );
}
