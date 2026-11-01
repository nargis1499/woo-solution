import "server-only";
import { reportMoneyForModel } from "@/lib/ai/report-money";
import { assertAdmin } from "@/lib/admin/auth";
import { UUID_RE } from "@/lib/admin/form";
import { createClient } from "@/lib/supabase/server";
import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type { AiResponsePolicy } from "@/lib/ai/response-budget";
import type { AiActionPlanItem, AiActionPlan, AiToolBadge, AiUiWidget } from "@/lib/ai/types";
import { formatMoney, USD_MONEY, type Money } from "@/lib/money";
import { readOrders } from "./service";
import type { OrderOperation, OrderReportMode } from "./types";

const properties = {
  mode: { type: "string", enum: ["search", "detail", "report", "customers", "problems"], description: "search=paged orders; detail=items/timeline; report=paid analytics/comparison; customers=history/co-purchases; problems=alerts." },
  id: { type: "string", description: "Exact order UUID." },
  orderNumber: { type: "integer", description: "Displayed order number." },
  customerId: { type: "string", description: "Exact customer user UUID." },
  customerOrderId: { type: "string", description: "Identify customer by exact order UUID; avoids email." },
  customer: { type: "string", description: "Name/email substring; keep identities separate." },
  email: { type: "string", description: "Exact customer email." },
  product: { type: "string", description: "Purchased product name substring." },
  status: { type: "string", enum: ["pending", "processing", "completed", "cancelled", "refunded"] },
  paymentStatus: { type: "string", enum: ["unpaid", "paid", "refunded"], description: "Unpaid is not failed; gateway attempts unavailable." },
  fulfillmentStatus: { type: "string", enum: ["unknown", "unfulfilled", "packed", "shipped", "delivered"] },
  shippingStatus: { type: "string", enum: ["unknown", "pending", "in_transit", "delayed", "delivered"] },
  from: { type: "string", description: "Inclusive UTC date; report=30d, problems=90d, customers=all. 1970-01-01=all history." },
  to: { type: "string", description: "Exclusive UTC date; default now. Inclusive end dates need next-day boundary." },
  minValue: { type: "number", description: "Minimum order total, display currency." },
  maxValue: { type: "number", description: "Maximum order total, display currency." },
  minQuantity: { type: "integer", description: "Minimum units/order." },
  maxQuantity: { type: "integer", description: "Maximum units/order." },
  limit: { type: "integer", description: "Rows 1-50; UI browsing is model-free." },
  inactiveDays: { type: "integer", description: "Inactivity days 1-3650; default 90." },
  includeCombinations: { type: "boolean", description: "Compute co-purchases only when requested; expensive." },
  inactiveOnly: { type: "boolean", description: "Filter customer cohort, not order rows." }, repeatOnly: { type: "boolean", description: "Filter customer cohort, not order rows." }, highRiskOnly: { type: "boolean", description: "History has >=3 cancellations or >=2 refunds; not proof of fraud." },
  processingHours: { type: "integer", description: "Stale processing hours 1-720; default 72." },
  fulfillmentHours: { type: "integer", description: "Fulfillment age hours; default 48 without deadline." },
  paymentHours: { type: "integer", description: "Unpaid hours; default 24. COD is not failed." },
  highValue: { type: "number", description: "Review threshold, display currency; default USD 1000 equivalent." },
  highQuantity: { type: "integer", description: "High quantity; default 20 units." },
};
export const ORDER_INTELLIGENCE_TOOLS: AiToolSpec[] = [
  {
    name: "query_order_intelligence",
    description: "Read orders, paid analytics/comparisons, history or problems by mode. Formatted USD reports; legacy missing fees/times are unknown. Changes need previews.",
    parameters: { type: "object", properties },
  },
  {
    name: "preview_order_operations",
    description: "Preview explicit orders (max 50), Approval ALWAYS required, even auto-apply. Refund requests never transfer money/mark refunded. Notes private; notifications are order-chat/in-app, not email/SMS. Valid transitions only; no arbitrary payment edits/deletion.",
    parameters: {
      type: "object", properties: {
        orders: { type: "array", items: { type: "string" }, description: "Exact UUIDs/order numbers, max 50; read first, never invent bulk targets." },
        action: { type: "string", enum: ["status", "refund_request", "note", "notification", "fulfillment", "shipping"] },
        status: { type: "string", enum: ["pending", "processing", "completed", "cancelled"] },
        text: { type: "string", description: "FULL text: note/reason <=2000 chars, notification <=200. Never shorten approved copy." },
        fulfillmentStatus: { type: "string", enum: ["unfulfilled", "packed", "shipped", "delivered"] },
        shippingStatus: { type: "string", enum: ["pending", "in_transit", "delayed", "delivered"] },
        trackingNumber: { type: "string" }, trackingUrl: { type: "string", description: "HTTPS only." }, carrier: { type: "string" },
        expectedDeliveryAt: { type: "string", description: "ISO timestamp, UTC." }, fulfillmentDueAt: { type: "string", description: "ISO timestamp, UTC." },
      }, required: ["orders", "action"],
    },
  },
];

export async function executeOrderTool(call: AiToolCall, policy: AiResponsePolicy, money: Money): Promise<{
  toolOutputJson: string; badge: AiToolBadge; widget?: AiUiWidget; plan?: AiActionPlan; completionSummary?: string;
}> {
  await assertAdmin();
  const badge = { id: call.id, name: call.name, summary: `${call.name}(live order data)` };
  if (call.name === "query_order_intelligence") {
    const mode = String(call.arguments.mode ?? "search") as OrderReportMode;
    if (!["search", "detail", "report", "customers", "problems"].includes(mode)) throw new Error("Invalid order report mode.");
    const report = await readOrders(call.arguments, mode, money);
    const m = report.metrics;
    const revenueDelta = m && m.previousRevenueMicros > 0 ? (m.revenueMicros - m.previousRevenueMicros) / m.previousRevenueMicros : null;
    const orderDelta = m && m.previousOrders > 0 ? (m.orders - m.previousOrders) / m.previousOrders : null;
    const insight = revenueDelta != null && Math.abs(revenueDelta) >= 0.25
      ? `Revenue is ${revenueDelta >= 0 ? "up" : "down"} ${Math.abs(revenueDelta * 100).toFixed(1)}% versus the equal-length previous period; review the comparison below`
      : orderDelta != null && Math.abs(orderDelta) >= 0.25
        ? `Order volume is ${orderDelta >= 0 ? "up" : "down"} ${Math.abs(orderDelta * 100).toFixed(1)}% versus the equal-length previous period; review the comparison below`
        : "Status breakdowns and previous-period comparisons are below";
    const completionSummary = mode === "report" && report.metrics
      ? `${report.total} orders reviewed; eligible paid revenue ${formatMoney(report.metrics.revenueMicros, USD_MONEY)} and paid-order AOV ${formatMoney(report.metrics.aovMicros, USD_MONEY)} (USD). ${insight}; no changes were made.`
      : undefined;
    return { badge, completionSummary, widget: { ...report, id: `orders_${call.id}`, kind: "order_intelligence", initialVisibleRows: policy.visibleRows },
      toolOutputJson: JSON.stringify(reportMoneyForModel({
        mode, generatedAt: report.generatedAt, filters: report.filters, total: report.total, hasMore: report.hasMore,
        metrics: report.metrics, baseCurrency: "USD", sample: report.rows.slice(0, policy.modelSampleRows).map(o => ({
          id: o.id, orderNumber: o.order_number, status: o.status, payment: o.payment_status, fulfillment: o.fulfillment_status,
          totalMicros: o.total_micros, quantity: o.quantity, flags: o.flags,
          ...(mode === "detail" ? { itemCount: o.items?.length, items: o.items?.slice(0, policy.modelSampleRows).map(i => ({ name: i.product_name, variant: i.variation_label, quantity: i.quantity, lineMicros: i.line_total_micros })), timelineCount: o.timelineCount, timeline: o.timeline?.slice(0, 5).map(e => ({ event: e.event, success: e.success, at: e.created_at })) } : {}),
        })),
        topProducts: report.topProducts.slice(0, policy.modelSampleRows),
        highestRevenueProducts: report.highestRevenueProducts.slice(0, policy.modelSampleRows),
        customers: report.customers.slice(0, policy.modelSampleRows).map(c => ({ name: c.name, customerOrderId: c.sample_order_id, purchases: c.purchases, spendingMicros: c.spending, cancellations: c.cancellations, refunds: c.refunds, lastPurchase: c.last_purchase, frequencyDays: c.frequency_days })),
        combinations: report.combinations.slice(0, policy.modelSampleRows),
        instruction: policy.summaryInstruction + " Dashboard contains full loaded details and local pagination. Model item/customer/product examples are sampled, not complete lists. Totals cover all matching orders, not only the page. Revenue/AOV use paid non-cancelled orders only, in USD; line sales are gross item sales. Counts of refunded orders are not refund-amount accounting. Payment success/failure rates cannot be calculated without gateway attempt data; show recorded payment-status distribution only. Unknown legacy tax/discount/timestamps are not zero. Never expose addresses/payment transaction identifiers in summaries. Customer switches (inactiveOnly/repeatOnly/highRiskOnly) filter the customer list and exact full-cohort metrics, not the base order totals/rows. Money is already formatted USD; never rescale it. Use cohortSpendingUSD/cohortOrders/cohortPurchases for cohort questions; never sum just the top customer examples. Customer spending/frequency is limited to the displayed history window; lifetime only for all-history scope.",
      }, ["sales"])),
    };
  }
  const a = call.arguments;
  const operation = String(a.action) as OrderOperation;
  if (!["status", "refund_request", "note", "notification", "fulfillment", "shipping"].includes(operation)) throw new Error("Unsupported order action.");
  if (!Array.isArray(a.orders) || a.orders.length < 1 || a.orders.length > 50) throw new Error("Choose 1-50 explicit orders.");
  const keys = ["status", "text", "fulfillmentStatus", "shippingStatus", "trackingNumber", "trackingUrl", "carrier", "expectedDeliveryAt", "fulfillmentDueAt"];
  const payload: Record<string, string> = {};
  for (const key of keys) {
    if (a[key] == null) continue;
    if (typeof a[key] !== "string") throw new Error(`Invalid ${key}.`);
    payload[key] = a[key].trim();
  }
  if (Object.keys(payload).length === 0 && operation !== "refund_request") throw new Error("No proposed changes supplied.");
  const db = await createClient();
  const items: AiActionPlanItem[] = [];
  const rejected: string[] = [];
  for (const target of [...new Set(a.orders)]) {
    if (typeof target !== "string" || (!UUID_RE.test(target) && !/^\d{1,15}$/.test(target))) throw new Error("Use order UUIDs or numeric order numbers.");
    const query = db.from("orders").select("id, order_number");
    const { data: order, error: lookupError } = await (UUID_RE.test(target) ? query.eq("id", target) : query.eq("order_number", Number(target))).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!order) { rejected.push(`${target}: order not found`); continue; }
    const { data, error } = await db.rpc("nemesis_prepare_order_action", { p_order_id: order.id, p_action: operation, p_payload: payload });
    if (error) { rejected.push(`#${order.order_number}: ${error.message}`); continue; }
    const preview = data as { previewId: string; expiresAt: string; oldStatus: string; oldFulfillment: string; oldShipping: string };
    items.push({ id: preview.previewId, title: `Order #${order.order_number}`, subtitle: operation.replaceAll("_", " "),
      oldValueLabel: `${preview.oldStatus} · ${preview.oldFulfillment} · ${preview.oldShipping}`,
      newValueLabel: operation === "refund_request" ? "Record refund request — no money transfer" : operation === "notification" ? "Send order-chat notification (not email/SMS)" : operation === "status" ? payload.status : operation === "fulfillment" ? `Fulfillment: ${payload.fulfillmentStatus}` : operation.replaceAll("_", " "),
      detailText: Object.entries(payload).map(([key, value]) => `${key}: ${value}`).join("\n") + `\nApproval expires ${preview.expiresAt}`,
      mutation: { kind: "order_operation", previewId: preview.previewId },
    });
  }
  return { badge, toolOutputJson: JSON.stringify({ previewCount: items.length, rejectedCount: rejected.length, rejected: rejected.slice(0, policy.modelSampleRows), saved: false, instruction: "Review the approval card. Nothing is executed until the administrator selects and approves. Refund requests never transfer funds." }),
    ...(items.length ? { plan: { id: `order_plan_${call.id}`, title: "Review order operations", description: `Approve selected operations only. ${rejected.length ? `${rejected.length} ineligible target(s): ${rejected.join("; ")}` : "Eligibility and current version will be rechecked atomically."}`, applyLabel: "Approve selected operations", requiresApproval: true, items } } : {}),
  };
}
