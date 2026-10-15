"use client";

import type { Selection } from "react-aria-components";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatBytes, formatLabel } from "@/lib/media/shared";
import type { MediaItem, MediaUsage } from "@/lib/types";
import { CopyUrlButton, MediaThumb, dimensionsOf, relativeTime, usageLabel } from "./media-bits";

export type MediaCollectionProps = {
  items: MediaItem[];
  selected: Set<string>;
  onToggle: (id: string, selected: boolean) => void;
  /** Click on the file itself (open details – or toggle, inside the picker). */
  onOpen: (item: MediaItem) => void;
  usage?: Record<string, MediaUsage[]>;
  /** Smaller tiles / fewer columns (media picker). */
  compact?: boolean;
  /** Hide the per-row action buttons (media picker). */
  readOnly?: boolean;
  /** Shown greyed-out and not selectable (e.g. already attached to the product). */
  disabledIds?: Set<string>;
};

/* ─── Grid ────────────────────────────────────────────────────────────────── */

export function MediaGrid({ items, selected, onToggle, onOpen, usage, compact, readOnly, disabledIds }: MediaCollectionProps) {
  return (
    <ul
      className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6")}
      aria-label="Files"
      data-testid="media-grid"
    >
      {items.map((item) => {
        const isSelected = selected.has(item.id);
        const isDisabled = disabledIds?.has(item.id) ?? false;
        const used = usageLabel(usage?.[item.id]);
        return (
          <li key={item.id} className={cn("group relative", isDisabled && "opacity-50")} data-media-id={item.id} data-selected={isSelected || undefined} data-disabled={isDisabled || undefined}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              disabled={isDisabled}
              className={cn(
                "block w-full overflow-hidden rounded-xl border bg-card text-left outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50",
                isSelected ? "border-primary ring-2 ring-primary/40" : "hover:border-foreground/20 hover:shadow-sm",
                isDisabled && "cursor-not-allowed",
              )}
              aria-label={`${item.name}${isSelected ? " (selected)" : ""}${isDisabled ? " (already added)" : ""}`}
              title={isDisabled ? "Already added" : undefined}
            >
              <MediaThumb item={item} rounded="rounded-none" className="aspect-square w-full" />
              <div className={cn("space-y-0.5 border-t", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
                <p className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")} title={item.name}>
                  {item.name}
                </p>
                <p className="flex flex-wrap items-center gap-x-1 text-[11px] leading-4 text-muted-foreground">
                  <span className="font-semibold tracking-wide uppercase">{formatLabel(item.mime_type, item.name)}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{formatBytes(item.size)}</span>
                  {!compact && dimensionsOf(item) && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{dimensionsOf(item)}</span>
                    </>
                  )}
                </p>
                {!compact && (used || item.deleted_at) && (
                  <p className="truncate text-[11px] text-muted-foreground">{item.deleted_at ? `Deleted ${relativeTime(item.deleted_at)}` : used}</p>
                )}
              </div>
            </button>
            {/* selection checkbox – always visible once selected, on hover / focus otherwise */}
            <div
              className={cn(
                "absolute top-2 left-2 rounded-md bg-background/90 p-0.5 shadow-sm ring-1 ring-foreground/10 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <Checkbox aria-label={`Select ${item.name}`} isSelected={isSelected} isDisabled={isDisabled} onChange={(v) => onToggle(item.id, v)} />
            </div>
            {!readOnly && (
              <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <CopyUrlButton item={item} size="icon-xs" variant="secondary" className="bg-background/90 shadow-sm ring-1 ring-foreground/10" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ─── List ────────────────────────────────────────────────────────────────── */

export function MediaList({ items, selected, onToggle, onOpen, usage, compact, readOnly, disabledIds }: MediaCollectionProps) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const pageSelected = new Set(items.filter((i) => selected.has(i.id)).map((i) => i.id));
  const inTrash = Boolean(items[0]?.deleted_at);

  function onSelectionChange(keys: Selection) {
    const next = keys === "all" ? new Set(items.map((i) => i.id)) : new Set([...keys].map(String));
    for (const item of items) {
      const was = pageSelected.has(item.id);
      const is = next.has(item.id);
      if (was !== is) onToggle(item.id, is);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card" data-testid="media-list">
      <Table
        aria-label="Files"
        className="min-w-[640px]"
        selectionMode="multiple"
        selectionBehavior="toggle"
        selectedKeys={pageSelected}
        disabledKeys={disabledIds}
        onSelectionChange={onSelectionChange}
        onRowAction={(key) => {
          const item = byId.get(String(key));
          if (item) onOpen(item);
        }}
      >
        <TableHeader>
          <TableHead id="__selection" className="w-10">
            <Checkbox slot="selection" aria-label="Select all on this page" />
          </TableHead>
          <TableHead id="preview" className="w-14">
            <span className="sr-only">Preview</span>
          </TableHead>
          <TableHead id="name" isRowHeader>
            Name
          </TableHead>
          <TableHead id="type">Type</TableHead>
          <TableHead id="size" className="text-right">
            Size
          </TableHead>
          {!compact && <TableHead id="dimensions">Dimensions</TableHead>}
          <TableHead id="date">{inTrash ? "Deleted" : "Uploaded"}</TableHead>
          {!compact && <TableHead id="used">Used</TableHead>}
          {!readOnly && (
            <TableHead id="actions" className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} id={item.id} data-media-id={item.id} className="cursor-pointer">
              <TableCell>
                <Checkbox slot="selection" aria-label={`Select ${item.name}`} />
              </TableCell>
              <TableCell>
                <MediaThumb item={item} className="size-10" />
              </TableCell>
              <TableCell className="max-w-[280px]">
                <span className="block truncate font-medium" title={item.name}>
                  {item.name}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatLabel(item.mime_type, item.name)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(item.size)}</TableCell>
              {!compact && <TableCell className="tabular-nums text-muted-foreground">{dimensionsOf(item) ?? "–"}</TableCell>}
              <TableCell className="text-muted-foreground">{relativeTime(item.deleted_at ?? item.created_at)}</TableCell>
              {!compact && <TableCell className="text-muted-foreground">{usageLabel(usage?.[item.id])?.replace("Used in ", "") ?? "–"}</TableCell>}
              {!readOnly && (
                <TableCell>
                  <CopyUrlButton item={item} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
