"use client";

import { useState } from "react";
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
  const [showAll, setShowAll] = useState(false);
  const compact = w.responseMode === "compact";
  const visibleRows = compact && !showAll ? w.rows.filter((r) => r.signals.length > 0).slice(0, w.initialVisibleRows ?? 5) : w.rows;
  const hiddenCount = w.rows.length - visibleRows.length;
  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-xs" aria-label="Inventory Intelligence report">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><BoxesIcon className="size-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Inventory Intelligence</h3>
            <p className="text-[11px] text-muted-foreground">{w.productsAnalyzed} products · {o.windowDays}-day sales · {o.leadTimeDays}-day lead time</p>
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
      <p className="text-[11px] text-muted-foreground">Product counts exclude duplicate SKUs. Showing {visibleRows.length} of {w.matchingCount} matching rows{w.filter !== "all" ? ` · ${SIGNAL_LABELS[w.filter as keyof typeof SIGNAL_LABELS] || w.filter}` : ""}.</p>
      {!w.stockTrackingEnabled && <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-foreground"><AlertTriangleIcon className="size-4 shrink-0" />Stock tracking is off. Only sales signals are available.</p>}

      {!w.complete && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-foreground">Sales history is incomplete. Forecasts and reorder suggestions are disabled.</p>}
      {visibleRows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{w.matchingCount === 0 ? "No products match these filters." : "No flagged products to show. Open product details below to inspect the available data."} No changes made.</p>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((r) => (
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
                <div><dt className="text-muted-foreground">Estimated depletion</dt><dd className="font-medium text-foreground">{!r.dataComplete || !r.stockManaged ? "Unavailable" : r.stock === 0 ? "Out of stock now" : r.daysToDepletion === null ? "Not enough sales" : `${decimal(r.daysToDepletion)} days`}</dd>{r.estimatedDepletionAt && r.stock > 0 && <dd className="text-[10px] text-muted-foreground">{date(r.estimatedDepletionAt)} UTC</dd>}</div>
                <div><dt className="text-muted-foreground">Suggested reorder</dt><dd className="font-medium text-primary">{r.dataComplete && r.stockManaged ? r.unitsSold === 0 ? "Not enough sales" : r.suggestedReorder > 0 ? `${r.suggestedReorder} units` : "Not needed" : "Unavailable"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                {r.signals.length ? r.signals.map((signal) => (
                  <span key={signal} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{SIGNAL_LABELS[signal]}</span>
                )) : <span className="text-[10px] text-muted-foreground">{r.dataComplete ? "No detected signals" : "Signals suppressed — incomplete attribution/data"}</span>}
              </div>
              <details className="text-[10px] text-muted-foreground">
                <summary className="cursor-pointer">Calculation details</summary>
                <div className="mt-2 space-y-1 leading-relaxed">
                  <p>{!r.dataComplete
                    ? "Sales history is incomplete; no reliable forecast yet."
                    : !r.stockManaged
                      ? "Stock tracking is off for this product."
                      : r.unitsSold === 0
                        ? `No sales in ${Math.round(r.observedDays)} days. More sales are needed to estimate restocking.`
                        : `${r.unitsSold} sold in ${Math.round(r.observedDays)} days (about ${decimal(r.dailyVelocity)}/day). ${r.suggestedReorder > 0 ? `Add ${r.suggestedReorder} units to reach ${r.targetStock} in stock.` : "No restock needed now."}`}</p>
                  {r.signals.includes("spike") && <p>{r.newDemand ? "Sales picked up after a quiet period." : `Recent sales are ${decimal(r.spikeRatio ?? 0)}× the earlier daily average.`}</p>}
                  {r.excessUnits > 0 && <p>About {r.excessUnits} units exceed {o.overstockDays} days of demand.</p>}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
      {compact && (hiddenCount > 0 || showAll) && (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full cursor-pointer rounded-lg border bg-muted/20 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/40">
          {showAll ? "Show flagged products only" : `Show all loaded product details (${w.rows.length})`}
        </button>
      )}
      <p className="text-[10px] text-muted-foreground">Estimates only. No stock changes or supplier orders were made.</p>
    </section>
  );
}
