"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { BoxesIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browseProductQueries } from "@/app/nemesis/ai-actions";
import { formatMoney } from "@/lib/money";
import { mediaUrl } from "@/lib/media/shared";
import type {
  AiProductQueryWidget,
  ProductFilters,
  ProductQueryReport,
} from "@/lib/ai/products/types";
const operators = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", ne: "≠" };
function filterLabel(filters: ProductFilters) {
  const labels: string[] = [];
  for (const field of ["stock", "price"] as const)
    for (const [op, n] of Object.entries(filters[field] ?? {}))
      labels.push(
        `${field} ${operators[op as keyof typeof operators]} ${n}${field === "price" && filters.currency ? ` ${filters.currency}` : ""}`,
      );
  for (const key of [
    "search",
    "name",
    "sku",
    "brand",
    "category",
    "categorySlug",
    "categoryId",
    "categorySlugs",
    "id",
    "productId",
    "ids",
    "createdFrom",
    "createdTo",
    "updatedFrom",
    "updatedTo",
  ] as const)
    if (filters[key] != null) labels.push(`${key}: ${String(filters[key])}`);
  for (const key of ["status", "type", "stockStatus"] as const)
    if (filters[key] !== "all") labels.push(`${key}: ${filters[key]}`);
  if (filters.scope !== "products")
    labels.push(`variation status: ${filters.variationStatus}`);
  for (const key of ["featured", "onSale"] as const)
    if (filters[key] != null)
      labels.push(`${key}: ${filters[key] ? "yes" : "no"}`);
  if (filters.anyOf)
    labels.push(
      `(${filters.anyOf
        .map((group) =>
          Object.entries(group)
            .flatMap(([field, rule]) =>
              Object.entries(rule).map(
                ([op, n]) =>
                  `${field} ${operators[op as keyof typeof operators]} ${n}`,
              ),
            )
            .join(" AND "),
        )
        .join(" OR ")})`,
    );
  labels.push(`${filters.sortBy} ${filters.sortDirection}`);
  return labels.join(" · ");
}
export function ProductQueryCard({ widget }: { widget: AiProductQueryWidget }) {
  const [report, setReport] = useState<ProductQueryReport>(widget);
  const [visible, setVisible] = useState(widget.initialVisibleRows);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  function browse(page: number) {
    setError("");
    start(async () => {
      const result = await browseProductQueries({ ...report.filters, page });
      if (result.ok) {
        setReport(result.report);
        setVisible(result.report.rows.length);
      } else setError(result.error);
    });
  }
  const { filters, rows, metrics } = report;
  const first = (filters.page - 1) * filters.limit;
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 shadow-xs"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <BoxesIcon className="size-4 text-primary" />
          {filters.scope === "products"
            ? "Products"
            : filters.scope === "skus"
              ? "Purchasable SKUs"
              : "Product variations"}
        </h3>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
          {report.total.toLocaleString()} matching
        </span>
      </div>
      <p className="break-words text-xs text-muted-foreground">
        {filterLabel({ ...filters, currency: report.money.currency })}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["Tracked units", metrics.trackedUnits],
          ["Untracked items", metrics.untracked],
          ["Out of stock", metrics.outOfStock],
          ["Low stock (1–3)", metrics.lowStock],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border bg-muted/25 px-3 py-2">
            <span className="block text-muted-foreground">{label}</span>
            <strong className="mt-1 block text-sm">
              {Number(n).toLocaleString()}
            </strong>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.slice(0, visible).map((row) => {
          const image = row.image_path
            ? mediaUrl(row.image_path)
            : row.image_url;
          return (
            <Link
              key={row.id}
              href={`/nemesis/products/${row.product_id}`}
              className="flex min-w-0 gap-3 rounded-lg border bg-background/60 p-3 transition-colors hover:border-primary/40"
            >
              {image ? (
                <span
                  className="size-12 shrink-0 rounded-md bg-muted bg-cover bg-center"
                  role="img"
                  aria-label={row.name}
                  style={{ backgroundImage: `url(${JSON.stringify(image)})` }}
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                  <BoxesIcon className="size-5 text-muted-foreground" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-xs font-semibold" title={row.name}>
                  {row.name}
                </h4>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[row.category, row.sku].filter(Boolean).join(" · ") ||
                    "No category / SKU"}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="font-semibold">
                    {row.price_micros == null
                      ? "No active priced options"
                      : formatMoney(row.price_micros, report.money)}
                  </span>
                  <span
                    className={
                      row.stock === 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground"
                    }
                  >
                    {row.stock == null
                      ? "Untracked stock"
                      : `${row.stock.toLocaleString()} in stock`}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {row.status === "active" ? "Published" : "Draft"}
                  {row.variation_status
                    ? ` · ${row.variation_status} variation`
                    : ""}
                  {row.on_sale ? " · On sale" : ""}
                  {row.featured ? " · Featured" : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
      {!rows.length && (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          {report.total
            ? "No items on this page. Use Previous to return to earlier results."
            : "No products match these filters."}
        </p>
      )}
      {visible < rows.length && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVisible(rows.length)}
        >
          Show all {rows.length} loaded items
        </Button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>
          {rows.length
            ? `${first + 1}–${first + Math.min(visible, rows.length)} of ${report.total.toLocaleString()}`
            : `0 shown of ${report.total.toLocaleString()}`}{" "}
          · Page {filters.page}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            isDisabled={busy || filters.page <= 1}
            onClick={() => browse(filters.page - 1)}
            aria-label="Previous product page"
          >
            <ChevronLeftIcon className="size-3.5" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            isDisabled={busy || !report.hasMore || filters.page >= 10000}
            onClick={() => browse(filters.page + 1)}
            aria-label="Next product page"
          >
            Next
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Full matching totals · {report.money.currency} · Refreshed{" "}
        {new Date(report.generatedAt).toLocaleString("en-GB", {
          timeZone: "UTC",
        })}{" "}
        UTC. Pages refresh live; totals may change. Untracked quantities are
        excluded from stock totals.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
