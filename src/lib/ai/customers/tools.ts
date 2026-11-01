import "server-only";
import { customerCompletionSummary, customerModelReport } from "./presentation";
import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type { AiResponsePolicy } from "@/lib/ai/response-budget";
import type { AiCustomerIntelligenceWidget } from "./types";
import { CUSTOMER_TOOL_MODES } from "./types";
import { isCustomerTool, readCustomers } from "./service";
const parameterDefinitions = {
  customerKey: {
    type: "string",
    description: "Exact key from search; never invent or merge identities.",
  },
  customerId: {
    type: "string",
    description: "Exact registered user UUID.",
  },
  search: {
    type: "string",
    description: "Literal name/email substring, max 120 characters.",
  },
  from: {
    type: "string",
    description:
      "Inclusive UTC order date; new/analytics default 30 days, otherwise all history.",
  },
  to: {
    type: "string",
    description: "Exclusive UTC order date; default now.",
  },
  limit: {
    type: "integer",
    description: "Rows 1-50; default 10.",
  },
  page: { type: "integer", description: "Page 1-10000." },
  inactiveDays: {
    type: "integer",
    description:
      "Days since last qualifying order; default 90, past buyers only.",
  },
  minPurchases: {
    type: "integer",
    description:
      "Minimum qualifying window purchases; repeat minimum/default 2.",
  },
  sort: {
    type: "string",
    enum: ["spending", "purchases", "newest", "oldest", "name"],
    description:
      "Window spending/count; lifetime first/last purchase date; or name.",
  },
};
// Providers can emit explicit null for omitted optional arguments. Match the
// service's null-as-absent behavior in the wire schema, before provider validation.
const properties = Object.fromEntries(
  Object.entries(parameterDefinitions).map(([name, definition]) => [
    name,
    {
      ...definition,
      type: [definition.type, "null"],
      // JSON Schema enums constrain null too, independently of the type union.
      ...("enum" in definition ? { enum: [...definition.enum, null] } : {}),
      description: definition.description,
    },
  ]),
);
const descriptions: Record<keyof typeof CUSTOMER_TOOL_MODES, string> = {
  get_customer_details:
    "Available customer profile and purchase totals. Requires exact identity; search first if unknown. Contacts are UI-only.",
  get_customer_purchase_history:
    "Paged orders, all statuses, for an exact customer. Search first if identity unknown.",
  search_customers:
    "Search registered customers and separate guest groups, including never-buyers. Returns exact keys and full-match totals.",
  get_top_customers:
    "Rank by qualifying window spending, not predicted value or profit.",
  get_inactive_customers:
    "Past buyers whose last qualifying order predates inactiveDays; not never-buyers or predicted churn.",
  get_repeat_customers:
    "At least two qualifying window purchases; configurable higher minimum.",
  get_new_customers:
    "First lifetime qualifying order date falls in window (default 30 days); not signups or verified conversion timestamps.",
  get_customer_analytics:
    "Full-cohort counts, spending, AOV and new/returning/repeat/inactive metrics; default 30 days.",
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
    completionSummary: customerCompletionSummary(report),
    toolOutputJson: JSON.stringify(customerModelReport(report, policy)),
  };
}
