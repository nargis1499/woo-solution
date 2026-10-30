/** Pure, deterministic inventory calculations. No model calls or database writes. */
export type InventorySignal = "depletion" | "dead" | "overstock" | "spike" | "reorder";
export type InventoryOptions = {
  windowDays: number;
  deadDays: number;
  overstockDays: number;
  leadTimeDays: number;
  safetyDays: number;
  reviewDays: number;
  spikeDays: number;
  baselineDays: number;
  spikeMultiplier: number;
  minSpikeUnits: number;
  depletionDays: number;
};
export const INVENTORY_DEFAULTS: InventoryOptions = {
  windowDays: 30, deadDays: 90, overstockDays: 90, leadTimeDays: 14,
  safetyDays: 7, reviewDays: 14, spikeDays: 7, baselineDays: 28,
  spikeMultiplier: 2, minSpikeUnits: 5, depletionDays: 14,
};
export function inventoryOptions(args: Record<string, unknown>): InventoryOptions {
  const result = { ...INVENTORY_DEFAULTS };
  const bounds: Record<keyof InventoryOptions, [number, number]> = {
    windowDays: [7, 365], deadDays: [7, 365], overstockDays: [7, 365], leadTimeDays: [0, 180],
    safetyDays: [0, 90], reviewDays: [1, 180], spikeDays: [1, 30], baselineDays: [7, 180],
    spikeMultiplier: [1.1, 20], minSpikeUnits: [2, 10000], depletionDays: [1, 180],
  };
  for (const key of Object.keys(result) as Array<keyof InventoryOptions>) {
    if (args[key] === undefined) continue;
    const value = args[key];
    const [min, max] = bounds[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (key !== "spikeMultiplier" && !Number.isInteger(value))) {
      throw new Error(`${key} must be ${key === "spikeMultiplier" ? "a number" : "an integer"} between ${min} and ${max}.`);
    }
    result[key] = value;
  }
  return result;
}
export type InventoryProduct = {
  id: string; name: string; sku: string | null; category_id: string | null;
  category: { name: string; slug: string } | null;
  type: "simple" | "variable"; stock: number; is_active: boolean;
  created_at: string; updated_at: string;
  variations: Array<{ id: string; label: string; sku: string | null; stock: number; is_active: boolean; created_at: string; updated_at: string }>;
};
export type InventorySale = {
  productId: string; variationId: string | null; quantity: number; createdAt: string;
};
export type InventoryInsightRow = {
  id: string; productId: string; variationId: string | null; name: string; sku: string | null;
  status: "active" | "draft"; stock: number; observedDays: number; unitsSold: number;
  dailyVelocity: number; planningVelocity: number; daysToDepletion: number | null;
  estimatedDepletionAt: string | null; recentUnits: number; baselineUnits: number;
  spikeRatio: number | null; newDemand: boolean; reorderPoint: number;
  targetStock: number; suggestedReorder: number; excessUnits: number;
  dataComplete: boolean; confidence: "limited" | "established"; signals: InventorySignal[];
};
export type InventoryReport = {
  generatedAt: string; options: InventoryOptions; stockTrackingEnabled: boolean;
  complete: boolean; warnings: string[]; productsAnalyzed: number; skuRowsAnalyzed: number;
  matchingCount: number; summary: Record<InventorySignal, number>; rows: InventoryInsightRow[];
};

export function calculateInventoryIntelligence(input: {
  products: InventoryProduct[]; sales: InventorySale[]; now: Date;
  options: InventoryOptions; stockTrackingEnabled: boolean; complete: boolean; warnings?: string[];
}): InventoryReport {
  const { options: o, now, complete, stockTrackingEnabled } = input;
  const DAY = 86400000;
  const nowMs = now.getTime();
  const salesByKey = new Map<string, InventorySale[]>();
  for (const sale of input.sales) {
    if (!Number.isFinite(sale.quantity) || sale.quantity <= 0) continue;
    const keys = [sale.productId, ...(sale.variationId ? [`${sale.productId}:${sale.variationId}`] : [])];
    for (const key of keys) {
      const list = salesByKey.get(key) ?? [];
      list.push(sale);
      salesByKey.set(key, list);
    }
  }
  const rows: InventoryInsightRow[] = [];
  let productsWithUnattributedSales = 0;
  for (const p of input.products) {
    // Parent signals use all product sales and total SELLABLE variation stock, not the parent stock column.
    const hasUnattributedSales = p.type === "variable" && (salesByKey.get(p.id) ?? []).some((sale) => !sale.variationId);
    if (hasUnattributedSales) productsWithUnattributedSales++;
    const activeVariations = (p.variations ?? []).filter((v) => v.is_active);
    const candidates = [{
      key: p.id, variationId: null as string | null, name: p.name, sku: p.sku,
      stock: p.type === "variable" ? activeVariations.reduce((n, v) => n + Math.max(0, Number(v.stock) || 0), 0) : p.stock,
      createdAt: p.created_at,
    }, ...(p.type === "variable" ? activeVariations.map((v) => ({
      key: `${p.id}:${v.id}`, variationId: v.id, name: `${p.name} — ${v.label}`,
      sku: v.sku, stock: v.stock, createdAt: v.created_at,
    })) : [])];
    for (const item of candidates) {
      const rowComplete = complete && !(item.variationId && hasUnattributedSales);
      const createdMs = Date.parse(item.createdAt);
      const age = Number.isFinite(createdMs) ? Math.max(0, (nowMs - createdMs) / DAY) : 0;
      const observedDays = Math.max(1, Math.min(o.windowDays, age));
      const sales = salesByKey.get(item.key) ?? [];
      const units = (fromDays: number, untilDays = 0) => sales.reduce((n, s) => {
        const elapsed = (nowMs - Date.parse(s.createdAt)) / DAY;
        return elapsed >= untilDays && elapsed < fromDays ? n + s.quantity : n;
      }, 0);
      const unitsSold = units(o.windowDays);
      const dailyVelocity = unitsSold / observedDays;
      const recentUnits = units(o.spikeDays);
      const baselineUnits = units(o.spikeDays + o.baselineDays, o.spikeDays);
      const recentRate = recentUnits / o.spikeDays;
      const baselineRate = baselineUnits / o.baselineDays;
      const comparable = age >= o.spikeDays + o.baselineDays;
      const spikeRatio = comparable && baselineRate > 0 ? recentRate / baselineRate : null;
      const newDemand = comparable && baselineUnits === 0 && recentUnits >= o.minSpikeUnits;
      const spike = rowComplete && comparable && recentUnits >= o.minSpikeUnits && (newDemand || (spikeRatio !== null && spikeRatio >= o.spikeMultiplier));
      // Respond to a detected spike, but do not treat it as guaranteed future demand.
      const planningVelocity = spike ? Math.max(dailyVelocity, recentRate) : dailyVelocity;
      const stock = Math.max(0, Number(item.stock) || 0);
      const daysToDepletion = rowComplete && stockTrackingEnabled && planningVelocity > 0 ? stock / planningVelocity : null;
      const dead = rowComplete && stockTrackingEnabled && age >= o.deadDays && stock > 0 && units(o.deadDays) === 0;
      const overstock = rowComplete && stockTrackingEnabled && age >= Math.min(14, o.windowDays) && dailyVelocity > 0 && stock / dailyVelocity > o.overstockDays;
      const reorderPoint = stockTrackingEnabled ? Math.ceil(planningVelocity * (o.leadTimeDays + o.safetyDays)) : 0;
      const targetStock = stockTrackingEnabled ? Math.ceil(planningVelocity * (o.leadTimeDays + o.safetyDays + o.reviewDays)) : 0;
      const suggestedReorder = rowComplete && stockTrackingEnabled && stock <= reorderPoint ? Math.max(0, targetStock - stock) : 0;
      const signals: InventorySignal[] = [];
      if (rowComplete && daysToDepletion !== null && daysToDepletion <= o.depletionDays) signals.push("depletion");
      if (dead) signals.push("dead");
      if (overstock) signals.push("overstock");
      if (spike) signals.push("spike");
      if (suggestedReorder > 0) signals.push("reorder");
      rows.push({
        id: item.key, productId: p.id, variationId: item.variationId, name: item.name,
        sku: item.sku, status: p.is_active ? "active" : "draft", stock, observedDays,
        unitsSold, dailyVelocity, planningVelocity, daysToDepletion,
        estimatedDepletionAt: daysToDepletion !== null && daysToDepletion <= 3650 ? new Date(nowMs + daysToDepletion * DAY).toISOString() : null,
        recentUnits, baselineUnits, spikeRatio, newDemand, reorderPoint, targetStock, suggestedReorder,
        excessUnits: overstock ? Math.max(0, stock - Math.ceil(dailyVelocity * o.overstockDays)) : 0,
        dataComplete: rowComplete, confidence: rowComplete && age >= 14 && unitsSold >= 5 ? "established" : "limited", signals,
      });
    }
  }
  // Stable priority: reorder/depletion first, then spikes, dead and overstock.
  const score = (r: InventoryInsightRow) => r.signals.reduce((n, s) => n + ({ reorder: 16, depletion: 8, spike: 4, dead: 2, overstock: 1 }[s]), 0);
  rows.sort((a, b) => score(b) - score(a) || (a.daysToDepletion ?? Infinity) - (b.daysToDepletion ?? Infinity) || a.id.localeCompare(b.id));
  const parents = rows.filter((r) => !r.variationId);
  const summary = Object.fromEntries((["depletion", "dead", "overstock", "spike", "reorder"] as InventorySignal[]).map((s) => [s, parents.filter((r) => r.signals.includes(s)).length])) as InventoryReport["summary"];
  const warnings = [...(input.warnings ?? [])];
  warnings.push("Estimates use order creation dates: completed or paid processing orders only; cancelled, pending and refunded orders are excluded. Partial refunds/returns are not modeled.", "Stockout periods, historic stock adjustments, seasonality, supplier orders and inbound stock are not tracked by this model. Reorders assume no inbound units and are suggestions, not purchase orders.", "Limited history is not reliable evidence of dead stock. Parent and variation rows overlap; do not add their reorder quantities together.");
  if (productsWithUnattributedSales) warnings.push(`${productsWithUnattributedSales} variable products have sales without variation IDs. Parent totals include them, but SKU-level signals/reorders for those products are suppressed to avoid false conclusions.`);
  if (!stockTrackingEnabled) warnings.push("Store stock tracking is disabled: depletion, dead-stock, overstock and reorder signals are disabled.");
  if (!complete) warnings.push("Dataset is incomplete. Signals and reorder suggestions are suppressed; do not use partial sales totals for inventory decisions.");
  return { generatedAt: now.toISOString(), options: o, stockTrackingEnabled, complete, warnings, productsAnalyzed: parents.length, skuRowsAnalyzed: rows.length - parents.length, matchingCount: rows.length, summary, rows };
}
