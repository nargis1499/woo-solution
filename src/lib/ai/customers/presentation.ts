import { formatMoney, USD_MONEY } from "@/lib/money";
import type { AiResponsePolicy } from "../response-budget";
import { reportMoneyForModel } from "../report-money";
import type { CustomerReport } from "./types";

/** Private contacts and raw micros never enter the model's report payload. */
export function customerModelReport(
  report: CustomerReport,
  policy: AiResponsePolicy,
) {
  const { mode, filters, metrics } = report;
  return reportMoneyForModel(
    {
      mode,
      scope: {
        from: filters.from,
        to: filters.to,
        ...(mode === "inactive" || mode === "analytics"
          ? { inactiveDays: filters.inactiveDays }
          : {}),
        ...(mode === "repeat" ? { minPurchases: filters.minPurchases } : {}),
        sort: filters.sort,
        page: filters.page,
      },
      total: report.total,
      metrics,
      customers: report.rows.slice(0, policy.modelSampleRows).map((c) => ({
        key: c.key,
        name: c.name,
        identity: c.identity,
        windowPurchases: c.window_purchases,
        spending: c.window_spending,
        ...(mode === "inactive" || mode === "details" || mode === "history"
          ? {
              lifetimePurchases: c.purchases,
              lifetimeSpendingMicros: c.spending,
              lastPurchase: c.last_purchase,
            }
          : {}),
        ...(mode === "new" || mode === "details"
          ? { firstPurchase: c.first_purchase }
          : {}),
        ...(mode === "details"
          ? {
              orders: c.orders,
              cancellations: c.cancellations,
              refunds: c.refunds,
              registeredAt: c.registered_at,
            }
          : {}),
      })),
      ...(mode === "history"
        ? {
            history: report.history
              .slice(0, policy.modelSampleRows)
              .map((o) => ({
                id: o.id,
                orderNumber: o.order_number,
                createdAt: o.created_at,
                status: o.status,
                paymentStatus: o.payment_status,
                totalMicros: o.total_micros,
                qualifyingPurchase: o.eligible,
              })),
          }
        : {}),
      note: "Metrics cover all matches; rows are samples. Purchases/spending require completed AND paid. USD strings are already formatted; never rescale. Dates use current-status qualifying order placement, not historical conversion time.",
    },
    ["spending", "aov"],
  );
}

export function customerCompletionSummary(report: CustomerReport): string {
  const m = report.metrics;
  if (!m.customers)
    return "No customers match the selected filters and order-date window.";
  if (
    report.mode === "top" &&
    report.filters.sort === "spending" &&
    Number(report.filters.page) === 1 &&
    report.rows[0]
  ) {
    const first = report.rows[0];
    const name = first.name.replace(/[\r\n]/g, " ").slice(0, 160);
    return `Top spending result for the selected order-date window: ${name} — ${formatMoney(first.window_spending, USD_MONEY)} USD from ${first.window_purchases} completed, paid purchase${first.window_purchases === 1 ? "" : "s"}.`;
  }
  if (report.mode === "inactive")
    return `${m.customers} past buyers have no completed, paid purchase in the last ${report.filters.inactiveDays} days before the selected cutoff. Review their lifetime purchase history in the card.`;
  if (report.mode === "new")
    return `${m.customers} matching buyers have their first lifetime qualifying order date in the selected window. This is not a signup or verified conversion-time count.`;
  if (report.mode === "repeat")
    return `${m.customers} matching customers made at least ${report.filters.minPurchases} completed, paid purchases in the selected order-date window, spending ${formatMoney(m.spending, USD_MONEY)} USD in total.`;
  return `${m.customers} matching customer identities; ${m.purchases} completed, paid purchases and ${formatMoney(m.spending, USD_MONEY)} USD spending in the selected order-date window. Details are in the card.`;
}
