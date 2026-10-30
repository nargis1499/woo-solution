import "server-only";
import { assertAdmin } from "@/lib/admin/auth";
import { UUID_RE } from "@/lib/admin/form";
import { createClient } from "@/lib/supabase/server";
import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type { AiActionPlan, AiToolBadge, AiUiWidget } from "@/lib/ai/types";
import {
  calculateInventoryIntelligence, inventoryOptions,
  type InventoryProduct, type InventorySale, type InventorySignal,
} from "./intelligence";

const filterValues = ["all", "depletion", "dead", "overstock", "spike", "reorder"];
const analysisProperties = {
  filter: { type: "string", enum: filterValues, description: "Signal to inspect; default all." },
  categorySlug: { type: "string", description: "Exact category slug (optional)." },
  search: { type: "string", description: "Product name or SKU substring (optional)." },
  status: { type: "string", enum: ["active", "draft", "all"], description: "Default active for reports, all for status previews." },
  windowDays: { type: "integer", description: "Sales velocity lookback, 7-365 days. Default 30." },
  deadDays: { type: "integer", description: "No sales for this many days, 7-365. Only stocked products at least this old qualify. Default 90." },
  overstockDays: { type: "integer", description: "Excess coverage threshold, 7-365 days. Default 90." },
  leadTimeDays: { type: "integer", description: "Supplier delivery lead time, 0-180 days. Default 14; ask admin for actual supplier timing." },
  safetyDays: { type: "integer", description: "Safety buffer, 0-90 days. Default 7." },
  reviewDays: { type: "integer", description: "Extra replenishment cycle coverage, 1-180 days. Default 14." },
  depletionDays: { type: "integer", description: "Flag stockouts within 1-180 days. Default 14." },
  spikeDays: { type: "integer", description: "Recent spike window, 1-30 days. Default 7." },
  baselineDays: { type: "integer", description: "Non-overlapping baseline BEFORE recent window, 7-180 days. Default 28." },
  spikeMultiplier: { type: "number", description: "Recent daily sales / baseline daily sales threshold, 1.1-20. Default 2." },
  minSpikeUnits: { type: "integer", description: "Minimum recent sales for a spike, 2-10000. Default 5." },
  limit: { type: "integer", description: "Maximum result/approval rows, 1-50. Default 20." },
};
export const INVENTORY_INTELLIGENCE_TOOLS: AiToolSpec[] = [
  {
    name: "analyze_inventory_intelligence",
    description: "Inventory Intelligence: deterministically forecast stock depletion from sales velocity, identify dead inventory and overstock, detect sales spikes, and calculate suggested reorder quantities. Reads real orders and stock, including variation/SKU-level analysis. Returns a dashboard with assumptions and data quality warnings; never guesses or saves stock. Use this instead of get_store_analytics/query_inventory for inventory predictions.",
    parameters: { type: "object", properties: analysisProperties },
  },
  {
    name: "preview_inventory_status_update",
    description: "Inventory Intelligence: prepare an admin-approval card to bulk publish/hide products by a computed signal (dead, overstock, depletion, spike, reorder) or an explicit list of product IDs. Recalculates live analysis, targets parent products only, and never changes stock counts or places supplier orders. Requires filter other than all OR explicit productIds. Ask for target status rather than choosing to hide products yourself.",
    parameters: {
      type: "object",
      properties: {
        ...analysisProperties,
        productIds: { type: "array", items: { type: "string" }, description: "Explicit parent product UUIDs to update (up to 50); not variation IDs." },
        targetStatus: { type: "string", enum: ["active", "draft"] },
      },
      required: ["targetStatus"],
    },
  },
];

async function loadInventoryData(days: number, now: Date) {
  const supabase = await createClient();
  const products: InventoryProduct[] = [];
  const sales: InventorySale[] = [];
  const warnings: string[] = [];
  let complete = true;
  // Bounded, explicitly paginated scans. Never silently treat a default 1000-row response as the entire store.
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase.from("products")
      .select("id, name, sku, category_id, type, stock, is_active, created_at, updated_at, category:categories(name, slug), variations:product_variations(id, label, sku, stock, is_active, created_at, updated_at)")
      .order("id", { ascending: true }).range(page * 500, page * 500 + 499);
    if (error) throw new Error(`Inventory product scan failed: ${error.message}`);
    products.push(...(data ?? []) as unknown as InventoryProduct[]);
    if ((data?.length ?? 0) < 500) break;
    if (page === 9) { complete = false; warnings.push("Product scan reached the 5,000-product safety cap. Narrowing filters does not remove this scan cap."); }
  }
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  let orderCount = 0;
  for (let page = 0; page < 40; page++) {
    const { data, error } = await supabase.from("orders")
      .select("id, created_at, status, payment_status, order_items(product_id, variation_id, quantity)")
      .gte("created_at", since).lte("created_at", now.toISOString())
      .in("status", ["processing", "completed"]).neq("payment_status", "refunded")
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(page * 250, page * 250 + 249);
    if (error) throw new Error(`Inventory sales scan failed: ${error.message}`);
    const orders = (data ?? []) as unknown as Array<{
      created_at: string; status: string; payment_status: string;
      order_items: Array<{ product_id: string | null; variation_id: string | null; quantity: number }>;
    }>;
    orderCount += orders.length;
    for (const order of orders) {
      if (order.status !== "completed" && order.payment_status !== "paid") continue;
      for (const item of order.order_items ?? []) {
        if (!item.product_id) continue; // Deleted/unlinked products cannot be attributed safely.
        sales.push({ productId: item.product_id, variationId: item.variation_id, quantity: Number(item.quantity), createdAt: order.created_at });
      }
    }
    if (orders.length < 250) break;
    if (page === 39) { complete = false; warnings.push("Sales scan reached the 10,000-order safety cap. Use a shorter history window or a server-side aggregate for larger stores."); }
  }
  warnings.push(`Scanned ${products.length} products and ${orderCount} eligible-status orders across ${days} days. Sales windows end at ${now.toISOString()}.`);
  return { products, sales, complete, warnings };
}

export async function executeInventoryTool(call: AiToolCall, stockTrackingEnabled: boolean): Promise<{
  toolOutputJson: string; badge: AiToolBadge; plan?: AiActionPlan; widget?: AiUiWidget;
}> {
  await assertAdmin();
  const a = call.arguments;
  const options = inventoryOptions(a);
  const filter = a.filter ?? "all";
  if (typeof filter !== "string" || !filterValues.includes(filter)) throw new Error("Choose a supported inventory signal.");
  const status = a.status ?? (call.name === "preview_inventory_status_update" ? "all" : "active");
  if (!["active", "draft", "all"].includes(String(status))) throw new Error("Choose active, draft or all products.");
  const limit = a.limit ?? 20;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be 1-50.");
  for (const key of ["categorySlug", "search"]) {
    if (a[key] !== undefined && (typeof a[key] !== "string" || (a[key] as string).length > 200)) throw new Error(`${key} must be text of at most 200 characters.`);
  }
  const explicitIds = a.productIds;
  if (explicitIds !== undefined && (!Array.isArray(explicitIds) || explicitIds.length === 0 || explicitIds.length > 50 || explicitIds.some((id) => typeof id !== "string" || !UUID_RE.test(id)))) throw new Error("Provide 1-50 real parent product UUIDs.");
  const preview = call.name === "preview_inventory_status_update";
  if (preview && a.targetStatus !== "active" && a.targetStatus !== "draft") throw new Error("Choose the desired active or draft status.");
  if (preview && filter === "all" && !explicitIds) throw new Error("Choose an inventory signal or explicit productIds; unrestricted bulk updates are not allowed.");
  const now = new Date();
  const historyDays = Math.max(options.windowDays, options.deadDays, options.spikeDays + options.baselineDays);
  const data = await loadInventoryData(historyDays, now);
  const category = typeof a.categorySlug === "string" ? a.categorySlug.trim() : "";
  const search = typeof a.search === "string" ? a.search.trim().toLowerCase() : "";
  const idSet = explicitIds ? new Set(explicitIds as string[]) : null;
  const products = data.products.filter((p) =>
    (status === "all" || p.is_active === (status === "active")) &&
    (!category || p.category?.slug === category) &&
    (!search || p.name.toLowerCase().includes(search) || (p.sku ?? "").toLowerCase().includes(search) || (p.variations ?? []).some((v) => (v.sku ?? "").toLowerCase().includes(search))) &&
    (!idSet || idSet.has(p.id)),
  );
  if (idSet && [...idSet].some((id) => !products.some((p) => p.id === id))) {
    throw new Error("Some productIds were not found or are outside the selected scope. Use parent product IDs and check category/status/search filters before retrying.");
  }
  const report = calculateInventoryIntelligence({ ...data, products, now, options, stockTrackingEnabled });
  const matched = report.rows.filter((r) => (filter === "all" || r.signals.includes(filter as InventorySignal)) && (!preview || r.variationId === null));
  const badge = { id: call.id, name: call.name, summary: `${call.name}(${filter}, ${options.windowDays}d)` };
  if (preview) {
    if (!report.complete) throw new Error("Inventory data is incomplete. Bulk signal-based status updates are blocked; reduce the history window or use the product editor.");
    const targets = matched.filter((r) => r.status !== a.targetStatus);
    const selected = targets.slice(0, limit);
    const productById = new Map(products.map((p) => [p.id, p]));
    const plan: AiActionPlan | undefined = selected.length ? {
      id: `inventory_${call.id}`, title: "Review inventory status changes",
      description: `${selected.length} of ${targets.length} matching parent products → ${a.targetStatus}. Stock quantities will not change. Review and approve; no supplier orders are placed.`,
      applyLabel: "Apply Inventory Changes", requiresApproval: true,
      items: selected.map((r) => {
        const product = productById.get(r.productId)!;
        return {
          id: `inventory_status_${r.productId}`, title: r.name, subtitle: r.sku || "Parent product",
          oldValueLabel: r.status === "active" ? "Active" : "Draft",
          newValueLabel: a.targetStatus === "active" ? "Active" : "Draft",
          detailText: `${r.stock} sellable units · ${r.unitsSold} sold / ${options.windowDays} days · signals: ${r.signals.join(", ") || "explicit selection"}. Confidence: ${r.confidence}.`,
          mutation: {
            kind: "inventory_status", productId: r.productId, isActive: a.targetStatus === "active",
            previousUpdatedAt: product.updated_at,
            variationVersions: product.type === "variable"
              ? (product.variations ?? []).map((v) => ({ id: v.id, updatedAt: v.updated_at }))
              : [],
          },
        };
      }),
    } : undefined;
    return { badge, plan, toolOutputJson: JSON.stringify({ status: plan ? "preview_ready" : "no_changes_needed", matchedCount: targets.length, previewCount: selected.length, saved: false, warnings: report.warnings, instruction: "Only parent products are changed. Use the approval card. No stock has been received or ordered." }) };
  }
  const widget = { ...report, id: `inventory_report_${call.id}`, kind: "inventory_intelligence" as const, filter, scope: { categorySlug: category, search, status: String(status) }, matchingCount: matched.length, rows: matched.slice(0, limit) };
  return {
    badge, widget,
    toolOutputJson: JSON.stringify({ ...widget, rows: widget.rows.slice(0, 12).map((r) => ({ productId: r.productId, variationId: r.variationId, name: r.name, stock: r.stock, sold: r.unitsSold, dailyVelocity: r.dailyVelocity, daysToDepletion: r.daysToDepletion, suggestedReorder: r.suggestedReorder, signals: r.signals, confidence: r.confidence })), instruction: "A structured dashboard shows the full displayed results. Summarize insights briefly. Estimates depend on stated assumptions. Reorders are suggestions, never silently change stock to targetStock. To bulk hide/publish use preview_inventory_status_update with explicit target status and the same analysis options." }),
  };
}
