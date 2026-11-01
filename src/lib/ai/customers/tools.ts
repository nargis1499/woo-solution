import "server-only";
import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type { AiResponsePolicy } from "@/lib/ai/response-budget";
import type { AiCustomerIntelligenceWidget } from "./types";
import { CUSTOMER_TOOL_MODES } from "./types";
import { isCustomerTool, readCustomers } from "./service";
const properties = {
  customerKey: {
    type: "string",
    description:
      "Exact opaque key returned by customer search. Never invent it or merge by name.",
  },
  customerId: {
    type: "string",
    description: "Exact registered user UUID, if already known.",
  },
  search: {
    type: "string",
    description:
      "Literal name/email substring, max 120 characters. Ambiguous matches stay separate.",
  },
  from: {
    type: "string",
    description:
      "Inclusive UTC order-placement date. Default all history; new/analytics default 30 days.",
  },
  to: {
    type: "string",
    description:
      "Exclusive UTC order-placement boundary, default now. Uses current recorded statuses, not historical status reconstruction.",
  },
  limit: {
    type: "integer",
    description: "Page size 1-50; default 10. UI pagination is model-free.",
  },
  page: { type: "integer", description: "Page 1-10000." },
  inactiveDays: {
    type: "integer",
    description:
      "Days since last completed/paid order date, default 90. Never-purchased accounts are not inactive buyers.",
  },
  minPurchases: {
    type: "integer",
    description:
      "Minimum completed AND paid purchases in the order-date window; repeat default 2.",
  },
  sort: {
    type: "string",
    enum: ["spending", "purchases", "newest", "oldest", "name"],
    description:
      "Spending/purchases use selected window; newest/oldest use lifetime first/last qualifying order dates.",
  },
};
const descriptions: Record<keyof typeof CUSTOMER_TOOL_MODES, string> = {
  get_customer_details:
    "Retrieve a selected customer's available profile, recorded contact details and purchase totals. Contacts render only in the admin card, not the model summary. Exact identity required; no authentication/payment secrets.",
  get_customer_purchase_history:
    "Retrieve a selected customer's paginated order history, all statuses. Completed AND paid eligibility is labelled per order. Exact identity required.",
  search_customers:
    "Search/filter registered customers and separately grouped guests, including registered accounts without purchases. Returns stable customer keys and exact full-match totals.",
  get_top_customers:
    "Rank customers by recorded completed/paid spending in the selected order-date window, not predicted lifetime value or profit.",
  get_inactive_customers:
    "Find past completed/paid buyers whose last qualifying order date is older than inactiveDays. Never-purchased accounts excluded. No churn prediction.",
  get_repeat_customers:
    "Find customers with multiple completed AND paid purchases in the selected order-date window; default minimum 2.",
  get_new_customers:
    "Find first-time converted buyers by their earliest lifetime completed/paid ORDER DATE within the window (default 30 days). Not new signups; actual conversion timestamps are not reconstructed.",
  get_customer_analytics:
    "Calculate exact full-cohort customer/buyer counts, completed/paid spending, AOV, new/returning/repeat/inactive counts. Default 30-day order-date window. Returns a structured chat dashboard.",
};
const identity = {
  customerKey: properties.customerKey,
  customerId: properties.customerId,
};
const dates = { from: properties.from, to: properties.to };
const paging = { limit: properties.limit, page: properties.page };
export const CUSTOMER_INTELLIGENCE_TOOLS: AiToolSpec[] = Object.entries(
  CUSTOMER_TOOL_MODES,
).map(([name, mode]) => ({
  name,
  description: descriptions[name as keyof typeof descriptions],
  parameters: {
    type: "object",
    properties:
      mode === "details"
        ? { ...identity, ...dates }
        : mode === "history"
          ? { ...identity, ...dates, ...paging }
          : {
              ...dates,
              ...paging,
              search: properties.search,
              sort: properties.sort,
              ...(mode === "inactive" || mode === "analytics"
                ? { inactiveDays: properties.inactiveDays }
                : {}),
              ...(mode === "repeat" || mode === "search"
                ? { minPurchases: properties.minPurchases }
                : {}),
            },
  },
}));
export async function executeCustomerTool(
  call: AiToolCall,
  policy: AiResponsePolicy,
) {
  if (!isCustomerTool(call.name)) throw new Error("Unknown customer tool.");
  const report = await readCustomers(
    call.arguments,
    CUSTOMER_TOOL_MODES[call.name],
  );
  const widget: AiCustomerIntelligenceWidget = {
    ...report,
    id: crypto.randomUUID(),
    kind: "customer_intelligence",
    initialVisibleRows: policy.visibleRows,
  };
  return {
    widget,
    badge: {
      id: call.id,
      name: call.name,
      summary: `${call.name}(live read-only customer data)`,
    },
    completionSummary: `Customer Intelligence is ready: ${report.metrics.customers} matching customer identities and ${report.metrics.purchases} completed, paid purchases in the selected order-date window.`,
    toolOutputJson: JSON.stringify({
      mode: report.mode,
      filters: {
        ...report.filters,
        search: report.filters.search ? "[filter applied]" : "",
      },
      total: report.total,
      metrics: report.metrics,
      customers: report.rows.slice(0, policy.modelSampleRows),
      history: report.history.slice(0, policy.modelSampleRows),
      instruction:
        policy.summaryInstruction +
        " Figures cover the full matching cohort, not just sampled rows. Purchases/spending mean completed AND paid; all money is base USD micros, not profit or predicted lifetime value. Lifetime columns are labelled separately from window columns. New buyers use first lifetime qualifying order placement date, NOT signup or verified conversion timestamp. Statuses are current, not reconstructed as-of history. Guest email groups are heuristic; never merge with registered accounts or by name. Do not request/echo contact data. Details contacts are UI-only. Refund/cancellation counts are not fraud. Do not send messages, edit customers or offer automatic account actions.",
    }),
  };
}
