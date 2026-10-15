"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { Selection } from "react-aria-components";
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type GridColumn = {
  id: string;
  label: ReactNode;
  /** Visually hide the header text (e.g. an actions column). */
  srOnly?: boolean;
  align?: "left" | "right";
  /** Applied to the header and every cell of the column. */
  className?: string;
  /** Applied to the cells only. */
  cellClassName?: string;
};

export type GridRow = {
  id: string;
  cells: ReactNode[];
  /** Plain-text name of the row – used for the drag handle's label and the reorder announcements. */
  label?: string;
  className?: string;
  /** Makes the whole row a link (click / Enter opens it; links and buttons inside keep working on their own). */
  href?: string;
  /** Row can be opened but never bulk-selected (e.g. the signed-in admin's own account). */
  unselectable?: boolean;
};

/** Rows can be dragged into a new order (mouse, touch, or ↑/↓ on the handle for keyboard users). */
export type Reorder = {
  /** Server action receiving every row id in the new order; resolve `{ error }` to roll the table back. */
  action: (ids: string[]) => Promise<{ error?: string } | void>;
  /** Toast shown once the new order is stored. */
  savedMessage?: string;
};

/** Extra (non-destructive) bulk action shown next to Delete, e.g. Publish / Move to drafts. Runs without confirmation. */
export type BulkAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Server action; receives every selected id as a repeated `ids` field plus `return_to`. */
  action: (formData: FormData) => void | Promise<void>;
};

export type BulkDelete = {
  /** Server action; receives every selected id as a repeated `ids` field plus `return_to`. */
  action: (formData: FormData) => void | Promise<void>;
  /** List URL the action redirects back to afterwards. */
  returnTo: string;
  /** Singular / plural noun for the bar and the confirmation copy, e.g. `["product", "products"]`. */
  noun: [singular: string, plural: string];
  description: string;
  /** Additional actions for the selection (shown before Delete). */
  extra?: BulkAction[];
};

/**
 * React Aria `Table` driven by plain data.
 *
 * Server components pass `columns` + `rows` (cell *contents* may be any JSX); the Row/Cell
 * collection nodes themselves are created here on the client. That matters: React Aria
 * collects its items inside a `<template>` during SSR, and when the server JSX tree was large
 * enough for React to split it into lazily streamed chunks, a chunk boundary inside that
 * template breaks hydration. Keeping the collection nodes client-side avoids it.
 *
 * Pass `bulkDelete` to get a checkbox column (click, Space, Shift+click for ranges, select all)
 * plus a floating "N selected" bar that deletes the selection after a confirmation.
 */
export function DataGrid({ label, columns, rows, className, bulkDelete, reorder }: { label: string; columns: GridColumn[]; rows: GridRow[]; className?: string; bulkDelete?: BulkDelete; reorder?: Reorder }) {
  const selectable = Boolean(bulkDelete);
  const selectableIds = rows.filter((r) => !r.unselectable).map((r) => r.id);
  const disabledKeys = rows.filter((r) => r.unselectable).map((r) => r.id);

  // The selection (and a drag-and-drop order) belongs to the rows currently on screen: whenever
  // that set changes (next page, new filter, rows deleted, order saved) it starts over from the
  // server's rows instead of carrying stale ids around.
  const rowsKey = rows.map((r) => r.id).join("\n");
  const [selectedKeys, setSelectedKeys] = useState<Selection>(() => new Set());
  const [prevRowsKey, setPrevRowsKey] = useState(rowsKey);
  if (prevRowsKey !== rowsKey) {
    setPrevRowsKey(rowsKey);
    setSelectedKeys(new Set());
  }
  // The drag order is only taken from the server again when rows appear or disappear – a refresh
  // that merely confirms an earlier save must not undo a drag that happened in the meantime.
  const rowsSetKey = rows.map((r) => r.id).sort().join("\n");
  const [order, setOrder] = useState(() => rows.map((r) => r.id));
  const [prevRowsSetKey, setPrevRowsSetKey] = useState(rowsSetKey);
  if (prevRowsSetKey !== rowsSetKey) {
    setPrevRowsSetKey(rowsSetKey);
    setOrder(rows.map((r) => r.id));
  }
  // Last order the server is known to hold – what a failed save rolls back to.
  const confirmedOrder = useRef(order);
  const confirmedSetKey = useRef(rowsSetKey);
  useEffect(() => {
    if (confirmedSetKey.current === rowsSetKey) return;
    confirmedSetKey.current = rowsSetKey;
    confirmedOrder.current = rows.map((r) => r.id);
  }, [rowsSetKey, rows]);

  const selectedIds = selectedKeys === "all" ? selectableIds : selectableIds.filter((id) => selectedKeys.has(id));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const visibleRows = reorder ? order.flatMap((id) => rowById.get(id) ?? []) : rows;
  const [, startReorder] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refocusHandle = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function save(next: string[]) {
    if (!reorder) return;
    startReorder(async () => {
      try {
        const result = await reorder.action(next);
        if (result?.error) throw new Error(result.error);
        confirmedOrder.current = next;
        toast.success(reorder.savedMessage ?? "Order saved.");
      } catch (e) {
        setOrder(confirmedOrder.current);
        toast.error(e instanceof Error && e.message ? e.message : "The new order could not be saved.");
      }
    });
  }

  /** Apply a new order optimistically; the server re-renders the list in that order once it is stored. */
  function moveRows(next: string[], { debounce = 0 } = {}) {
    if (!reorder || next.join("\n") === order.join("\n")) return;
    setOrder(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (debounce) saveTimer.current = setTimeout(() => save(next), debounce);
    else save(next);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    moveRows(arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
  }

  /** ↑ / ↓ on a handle moves the row one step; consecutive presses are stored as one change. */
  function nudge(id: string, direction: -1 | 1) {
    const from = order.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    refocusHandle.current = id;
    const label = rowById.get(id)?.label ?? "Row";
    setAnnouncement(`${label} moved to position ${to + 1} of ${order.length}.`);
    moveRows(arrayMove(order, from, to), { debounce: 800 });
  }

  // ↑ / ↓ while a handle is focused. Registered on `window` in the capture phase because React
  // Aria's grid handles arrow keys in its own capture listener (moving focus to the next row)
  // before a handler on the button itself would ever run.
  const nudgeRef = useRef(nudge);
  useEffect(() => {
    nudgeRef.current = nudge;
  });
  useEffect(() => {
    if (!reorder) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey) return;
      const handle = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-drag-handle]") : null;
      if (!handle || !handle.dataset.dragHandle) return;
      e.preventDefault();
      e.stopPropagation();
      nudgeRef.current(handle.dataset.dragHandle, e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [reorder]);

  // Moving a row re-inserts its <tr>, which drops keyboard focus – put it back on the same handle.
  // React Aria reacts to focus re-entering the table by focusing the first row, so claim it once
  // more on the next frame after that has happened.
  useEffect(() => {
    const id = refocusHandle.current;
    if (!id) return;
    refocusHandle.current = null;
    const focus = () => {
      const el = document.querySelector<HTMLElement>(`[data-drag-handle="${CSS_ESCAPE(id)}"]`);
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    };
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [order]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const table = (
    <>
      {/* Clips the rows to the card's radius so the card itself can stay `overflow-visible` for the sticky bar below. */}
      <div className="overflow-hidden rounded-[inherit]">
        <Table
          aria-label={label}
          className={className}
          selectionMode={selectable ? "multiple" : "none"}
          selectionBehavior="toggle"
          disabledBehavior="selection"
          disabledKeys={disabledKeys}
          selectedKeys={selectable ? selectedKeys : undefined}
          onSelectionChange={selectable ? setSelectedKeys : undefined}
        >
          <TableHeader>
            {reorder && (
              <TableHead id="__drag" className="w-10 pl-3">
                <span className="sr-only">Reorder</span>
              </TableHead>
            )}
            {selectable && (
              <TableHead id="__selection" className="w-10 pl-4">
                <Checkbox slot="selection" />
              </TableHead>
            )}
            {columns.map((c, i) => (
              <TableHead key={c.id} id={c.id} isRowHeader={i === 0} className={cn(c.align === "right" && "text-right", c.className)}>
                {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
              </TableHead>
            ))}
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => (
              <TableRow
                key={r.id}
                id={r.id}
                href={r.href}
                textValue={r.label}
                className={cn(
                  "outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-ring",
                  r.href && "cursor-pointer",
                  reorder && "data-dragging:relative data-dragging:z-10 data-dragging:bg-muted data-dragging:shadow-md",
                  r.className,
                )}
              >
                {reorder && (
                  <TableCell className="pl-3">
                    <DragHandle id={r.id} label={r.label} />
                  </TableCell>
                )}
                {selectable && (
                  <TableCell className="pl-4">
                    <Checkbox slot="selection" />
                  </TableCell>
                )}
                {r.cells.map((cell, i) => {
                  const c = columns[i];
                  return (
                    <TableCell key={c?.id ?? i} className={cn(c?.align === "right" && "text-right", c?.className, c?.cellClassName)}>
                      {cell}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {bulkDelete && selectedIds.length > 0 && <BulkDeleteBar key={rowsKey} ids={selectedIds} onClear={() => setSelectedKeys(new Set())} {...bulkDelete} />}
    </>
  );

  if (!reorder) return table;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: "Press the up or down arrow key to move this row; the new order is saved automatically." } }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {table}
      </SortableContext>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </DndContext>
  );
}

const CSS_ESCAPE = (value: string) => (typeof window !== "undefined" && window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, "\\$&"));

/**
 * Grip button that makes its own table row sortable (↑/↓ handling lives in DataGrid). Rendered as
 * cell *content* on purpose: React Aria builds its collection by rendering rows and cells into a
 * detached document first, and cell contents are skipped there – so this hook only ever runs
 * against the real `<tr>`.
 */
function DragHandle({ id, label }: { id: string; label?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const rowRef = useRef<HTMLTableRowElement | null>(null);

  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => {
      setActivatorNodeRef(el);
      rowRef.current = el?.closest("tr") ?? null;
      setNodeRef(rowRef.current);
    },
    [setActivatorNodeRef, setNodeRef],
  );

  // dnd-kit moves the row with a transform; the row element belongs to React Aria, so apply it imperatively.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    row.style.transform = CSS.Translate.toString(transform) ?? "";
    row.style.transition = transition ?? "";
    if (isDragging) row.setAttribute("data-dragging", "true");
    else row.removeAttribute("data-dragging");
  }, [transform, transition, isDragging]);

  return (
    <button
      ref={handleRef}
      type="button"
      {...attributes}
      {...listeners}
      data-drag-handle={id}
      aria-label={`Drag to reorder${label ? ` ${label}` : ""}`}
      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "cursor-grab touch-none text-muted-foreground active:cursor-grabbing")}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  );
}

/**
 * Floating "N selected" bar. It sits right after the table and is `position: sticky`, so it
 * hovers above the fold while a long table is on screen and docks at the bottom of the card
 * once you reach the end – always centred on the content, no portal or viewport maths needed.
 */
function BulkDeleteBar({ ids, onClear, action, returnTo, noun, description, extra = [] }: BulkDelete & { ids: string[]; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const count = ids.length;
  const what = `${count} ${count === 1 ? noun[0] : noun[1]}`;

  function submit(run: (formData: FormData) => void | Promise<void>, id: string) {
    setRunning(id);
    startTransition(async () => {
      const formData = new FormData();
      for (const i of ids) formData.append("ids", i);
      formData.set("return_to", returnTo);
      await run(formData); // redirects back to the list with a toast
    });
  }
  const confirm = () => submit(action, "delete");

  return (
    <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-3 py-3" data-testid="bulk-actions">
      <div
        role="toolbar"
        aria-label="Selected rows"
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full border bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur duration-200 animate-in fade-in-0 slide-in-from-bottom-2 supports-backdrop-filter:bg-popover/85"
      >
        <p className="whitespace-nowrap tabular-nums" aria-live="polite">
          <span className="font-semibold">{count}</span> selected
        </p>
        <Separator orientation="vertical" className="mx-2" />
        <Button variant="ghost" size="sm" className="rounded-full" onPress={onClear} isDisabled={pending}>
          <XIcon /> Clear
        </Button>
        {extra.map((a) => (
          <Button key={a.id} variant="outline" size="sm" className="rounded-full" onPress={() => submit(a.action, a.id)} isPending={pending} isDisabled={pending} aria-busy={pending && running === a.id} data-testid={`bulk-${a.id}`}>
            {pending && running === a.id ? <Spinner /> : a.icon}
            {a.label}
          </Button>
        ))}
        <Button variant="destructive" size="sm" className="rounded-full" aria-label="Delete selected" onPress={() => setConfirming(true)} isDisabled={pending}>
          <Trash2Icon /> Delete
        </Button>
      </div>

      <AlertDialog isOpen={confirming} onOpenChange={(open) => !pending && setConfirming(open)} isDismissable={!pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel isDisabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onPress={confirm} isPending={pending} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? "Deleting…" : `Delete ${what}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
