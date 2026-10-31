"use client";

import { BoxesIcon, AlertTriangleIcon } from "lucide-react";
import type { AiInventoryIntelligenceWidget } from "@/lib/ai/types";

const SIGNAL_LABELS = {
  depletion: "Depletion risk", dead: "Dead inventory", overstock: "Overstock",
  spike: "Sales spike", reorder: "Reorder needed",
};
const decimal = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export function InventoryIntelligenceCard({ widget: w }: { widget: AiInventoryIntelligenceWidget }) {
  const o = w.options;
  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-xs" aria-label="Inventory Intelligence report">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><BoxesIcon className="size-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Inventory Intelligence</h3>
            <p className="text-[11px] text-muted-foreground">{w.productsAnalyzed} products · {w.skuRowsAnalyzed} variation SKUs · {o.windowDays}-day velocity</p>
          </div>
        </div>
        <span className="rounded-full border bg-muted px-2 py-1 text-[10px] text-muted-foreground">{w.complete ? "Historical estimate" : "Incomplete data — signals disabled"}</span>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(SIGNAL_LABELS).map(([key, label]) => (
          <div key={key} className="rounded-lg border bg-muted/25 p-2.5">
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{w.summary[key as keyof typeof SIGNAL_LABELS]}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Counts above are parent products, not summed SKUs. Showing {w.rows.length} of {w.matchingCount} matching rows{w.filter !== "all" ? ` · ${SIGNAL_LABELS[w.filter as keyof typeof SIGNAL_LABELS] || w.filter}` : ""}.</p>
      {!w.stockTrackingEnabled && <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-foreground"><AlertTriangleIcon className="size-4 shrink-0" />Stock tracking is off. Only sales signals are available.</p>}

      {w.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No inventory matched these filters. No changes have been made.</p>
      ) : (
        <div className="space-y-3">
          {w.rows.map((r) => (
            <article key={r.id} className="space-y-3 rounded-lg border bg-background/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="break-words text-xs font-semibold text-foreground">{r.name}</h4>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{r.variationId ? "Variation SKU" : "Parent product"} · {r.sku || "No SKU"} · {r.status}</p>
                </div>
                <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.confidence === "limited" ? "Limited evidence" : "Established sales history"}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Sellable stock</dt><dd className="font-medium text-foreground">{r.stockManaged ? r.stock : "Not tracked"}</dd></div>
                <div><dt className="text-muted-foreground">Sold / velocity</dt><dd className="font-medium text-foreground">{r.unitsSold} / {decimal(r.dailyVelocity)} per day</dd></div>
                <div><dt className="text-muted-foreground">Estimated depletion</dt><dd className="font-medium text-foreground">{r.stockManaged && r.stock === 0 ? "Out of stock now" : r.daysToDepletion === null ? "Insufficient data / no velocity" : `${decimal(r.daysToDepletion)} days`}</dd>{r.estimatedDepletionAt && r.stock > 0 && <dd className="text-[10px] text-muted-foreground">{date(r.estimatedDepletionAt)} UTC</dd>}</div>
                <div><dt className="text-muted-foreground">Suggested reorder</dt><dd className="font-medium text-primary">{r.dataComplete && r.stockManaged ? `${r.suggestedReorder} units` : "Unavailable"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                {r.signals.length ? r.signals.map((signal) => (
                  <span key={signal} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{SIGNAL_LABELS[signal]}</span>
                )) : <span className="text-[10px] text-muted-foreground">{r.dataComplete ? "No detected signals" : "Signals suppressed — incomplete attribution/data"}</span>}
              </div>
              <details className="text-[10px] text-muted-foreground">
                <summary className="cursor-pointer">Calculation details</summary>
                <div className="mt-2 space-y-1 leading-relaxed">
                  <p>Velocity: {r.unitsSold} units ÷ {decimal(r.observedDays)} observed days. Planning velocity: {decimal(r.planningVelocity)} units/day{r.signals.includes("spike") ? " (uses higher recent rate during a spike)" : ""}.</p>
                  <p>Recent {o.spikeDays} days: {r.recentUnits} sold; preceding {o.baselineDays} days: {r.baselineUnits} sold. {r.newDemand ? "New demand from a zero-sales baseline." : r.spikeRatio !== null ? `${decimal(r.spikeRatio)}× daily-rate ratio.` : "Not enough comparable history or no baseline sales."}</p>
                  <p>Reorder point: {r.reorderPoint}. Target: {r.targetStock}. Suggested quantity is max(0, target − stock) only when stock is at/below the reorder point. Excess over {o.overstockDays}-day cover: {r.excessUnits}.</p>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
      <details className="rounded-lg border bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Assumptions & data quality</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>As of {w.generatedAt}. Lead time {o.leadTimeDays}d + safety {o.safetyDays}d + review cycle {o.reviewDays}d. These are configurable planning assumptions, not verified supplier terms.</p>
          <p>Dead inventory: stocked, at least {o.deadDays} days old, no sales in {o.deadDays} days. Overstock: more than {o.overstockDays} days of cover. Depletion risk: within {o.depletionDays} days. Spike: at least {o.minSpikeUnits} recent units and {o.spikeMultiplier}× baseline daily rate, or new demand after a zero baseline.</p>
          <ul className="list-disc space-y-1 pl-4">{w.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
          <p>No stock counts have changed. No supplier orders have been placed.</p>
        </div>
      </details>
    </section>
  );
}
