import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/product-image";

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
          <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
            ← {backLabel ?? "Back"}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "brand" | "emerald" | "amber" | "neutral";
}) {
  const accents = {
    brand: "from-brand-600 to-brand-400",
    emerald: "from-emerald-600 to-emerald-400",
    amber: "from-amber-500 to-amber-300",
    neutral: "from-neutral-500 to-neutral-300",
  };
  return (
    <div className="card relative overflow-hidden p-5">
      <span className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", accents[accent ?? "brand"])} aria-hidden />
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export function Table({ children, className, tableClassName }: { children: ReactNode; className?: string; tableClassName?: string }) {
  return (
    // `relative` keeps absolutely positioned helpers (sr-only headers) inside the scroll container
    <div className={cn("card relative overflow-x-auto", className)}>
      <table className={cn("w-full min-w-[640px] text-left text-sm", tableClassName)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">{children}</thead>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-3 font-medium", className)}>{children}</th>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-neutral-200">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-neutral-50", className)}>{children}</tr>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-neutral-500">
        {children}
      </td>
    </tr>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "emerald" | "amber" | "red" | "blue" | "brand";
  className?: string;
}) {
  const tones = {
    neutral: "bg-neutral-200 text-neutral-700",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-100 text-blue-800",
    brand: "bg-brand-50 text-brand-700 dark:text-brand-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Section({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("card p-5 sm:p-6", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{item.label}</dt>
          <dd className="mt-0.5 break-words text-neutral-900">{item.value ?? <span className="text-neutral-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Instant fallback used by every /nemesis `loading.tsx` while a page's data streams in. */
export function AdminPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-neutral-200" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-neutral-200" />
      <div className="card h-72 animate-pulse" />
    </div>
  );
}

/** Small square product thumbnail for tables and lists. */
export function Thumb({ src, size = "md", className }: { src: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "h-10 w-10" : size === "lg" ? "h-14 w-14" : "h-12 w-12";
  const px = size === "sm" ? "40px" : size === "lg" ? "56px" : "48px";
  return (
    <div className={cn(box, "shrink-0 overflow-hidden rounded-md", className)}>
      <ProductImage src={src} alt="" sizes={px} />
    </div>
  );
}
