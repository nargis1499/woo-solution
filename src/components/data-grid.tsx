"use client";

import type { ReactNode } from "react";
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

export type GridRow = { id: string; cells: ReactNode[]; className?: string };

/**
 * React Aria `Table` driven by plain data.
 *
 * Server components pass `columns` + `rows` (cell *contents* may be any JSX); the Row/Cell
 * collection nodes themselves are created here on the client. That matters: React Aria
 * collects its items inside a `<template>` during SSR, and when the server JSX tree was large
 * enough for React to split it into lazily streamed chunks, a chunk boundary inside that
 * template breaks hydration. Keeping the collection nodes client-side avoids it.
 */
export function DataGrid({ label, columns, rows, className }: { label: string; columns: GridColumn[]; rows: GridRow[]; className?: string }) {
  return (
    <Table aria-label={label} className={className}>
      <TableHeader>
        {columns.map((c, i) => (
          <TableHead key={c.id} id={c.id} isRowHeader={i === 0} className={cn(c.align === "right" && "text-right", c.className)}>
            {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
          </TableHead>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} id={r.id} className={r.className}>
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
  );
}
