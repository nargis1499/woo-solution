"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { Selection } from "react-aria-components";
import { Trash2Icon, XIcon } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
  className?: string;
  /** Makes the whole row a link (click / Enter opens it; links and buttons inside keep working on their own). */
  href?: string;
  /** Row can be opened but never bulk-selected (e.g. the signed-in admin's own account). */
  unselectable?: boolean;
};

export type BulkDelete = {
  /** Server action; receives every selected id as a repeated `ids` field plus `return_to`. */
  action: (formData: FormData) => void | Promise<void>;
  /** List URL the action redirects back to afterwards. */
  returnTo: string;
  /** Singular / plural noun for the bar and the confirmation copy, e.g. `["product", "products"]`. */
  noun: [singular: string, plural: string];
  description: string;
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
export function DataGrid({ label, columns, rows, className, bulkDelete }: { label: string; columns: GridColumn[]; rows: GridRow[]; className?: string; bulkDelete?: BulkDelete }) {
  const selectable = Boolean(bulkDelete);
  const selectableIds = rows.filter((r) => !r.unselectable).map((r) => r.id);
  const disabledKeys = rows.filter((r) => r.unselectable).map((r) => r.id);

  // The selection belongs to the rows currently on screen: whenever that set changes (next
  // page, new filter, rows deleted) it starts over instead of carrying stale ids around.
  const rowsKey = rows.map((r) => r.id).join("\n");
  const [selectedKeys, setSelectedKeys] = useState<Selection>(() => new Set());
  const [prevRowsKey, setPrevRowsKey] = useState(rowsKey);
  if (prevRowsKey !== rowsKey) {
    setPrevRowsKey(rowsKey);
    setSelectedKeys(new Set());
  }

  const selectedIds = selectedKeys === "all" ? selectableIds : selectableIds.filter((id) => selectedKeys.has(id));

  return (
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
            {rows.map((r) => (
              <TableRow
                key={r.id}
                id={r.id}
                href={r.href}
                className={cn("outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-ring", r.href && "cursor-pointer", r.className)}
              >
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
}

/**
 * Floating "N selected" bar. It sits right after the table and is `position: sticky`, so it
 * hovers above the fold while a long table is on screen and docks at the bottom of the card
 * once you reach the end – always centred on the content, no portal or viewport maths needed.
 */
function BulkDeleteBar({ ids, onClear, action, returnTo, noun, description }: BulkDelete & { ids: string[]; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const count = ids.length;
  const what = `${count} ${count === 1 ? noun[0] : noun[1]}`;

  function confirm() {
    startTransition(async () => {
      const formData = new FormData();
      for (const id of ids) formData.append("ids", id);
      formData.set("return_to", returnTo);
      await action(formData); // redirects back to the list with a toast
    });
  }

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
        <Button variant="ghost" size="sm" className="rounded-full" onPress={onClear}>
          <XIcon /> Clear
        </Button>
        <Button variant="destructive" size="sm" className="rounded-full" aria-label="Delete selected" onPress={() => setConfirming(true)}>
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
