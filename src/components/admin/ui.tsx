import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DataGrid, type BulkDelete, type GridColumn, type GridRow } from "@/components/data-grid";

/* Small layout primitives shared by all /nemesis pages. Server-safe (no hooks). */

export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" /> {backLabel ?? "Back"}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="items-center">
        <CardDescription>{label}</CardDescription>
        {icon && <CardAction className="text-muted-foreground [&_svg]:size-4">{icon}</CardAction>}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Card-wrapped React Aria table driven by `columns` + `rows` data (see `components/data-grid.tsx`).
 * With `bulkDelete` every row gets a checkbox and a floating "N selected → Delete" bar.
 */
export function DataTable({
  label,
  columns,
  rows,
  className,
  tableClassName,
  bulkDelete,
}: {
  label: string;
  columns: GridColumn[];
  rows: GridRow[];
  className?: string;
  tableClassName?: string;
  bulkDelete?: BulkDelete;
}) {
  return (
    // overflow-visible: the selection bar inside is `position: sticky` and must not be clipped by the card
    <Card className={cn("gap-0 overflow-visible py-0", className)}>
      <DataGrid label={label} columns={columns} rows={rows} className={cn("min-w-[640px]", tableClassName)} bulkDelete={bulkDelete} />
    </Card>
  );
}

export function EmptyState({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <Empty className="border border-dashed py-14">
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

type Tone = "neutral" | "emerald" | "amber" | "red" | "blue" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  blue: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  brand: "border-primary/30 bg-primary/10 text-primary",
};

/** Status chip with a semantic colour; `neutral` falls back to the secondary badge. */
export function ToneBadge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <Badge variant={tone === "neutral" ? "secondary" : "outline"} className={cn("capitalize", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

export function Section({
  title,
  description,
  children,
  className,
  actions,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  /** Render children edge-to-edge (lists, tables) instead of padded. */
  flush?: boolean;
}) {
  return (
    <Card className={cn(flush && "gap-0 pb-0", className)}>
      {(title || actions) && (
        <CardHeader className={cn(flush && "pb-4 [.border-b]:pb-4", flush && "border-b")}>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {actions && <CardAction>{actions}</CardAction>}
        </CardHeader>
      )}
      {flush ? children : <CardContent>{children}</CardContent>}
    </Card>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{item.label}</dt>
          <dd className="mt-0.5 break-words">{item.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Instant fallback used by every /nemesis `loading.tsx` while a page's data streams in. */
export function AdminPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

/** Small square product thumbnail for tables and lists. */
export function Thumb({ src, size = "md", className }: { src: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-10" : size === "lg" ? "size-14" : "size-12";
  const px = size === "sm" ? "40px" : size === "lg" ? "56px" : "48px";
  return (
    <div className={cn(box, "shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10", className)}>
      <ProductImage src={src} alt="" sizes={px} />
    </div>
  );
}
