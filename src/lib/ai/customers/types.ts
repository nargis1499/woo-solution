export const CUSTOMER_TOOL_MODES = {
  get_customer_details: "details",
  get_customer_purchase_history: "history",
  search_customers: "search",
  get_top_customers: "top",
  get_inactive_customers: "inactive",
  get_repeat_customers: "repeat",
  get_new_customers: "new",
  get_customer_analytics: "analytics",
} as const;
export type CustomerToolName = keyof typeof CUSTOMER_TOOL_MODES;
export type CustomerMode = (typeof CUSTOMER_TOOL_MODES)[CustomerToolName];
export type CustomerRow = {
  key: string;
  identity: "registered" | "guest_email_group" | "unidentified_order";
  name: string;
  registered_at: string | null;
  anchor_id: string | null;
  orders: number;
  purchases: number;
  spending: number;
  window_purchases: number;
  window_spending: number;
  first_purchase: string | null;
  last_purchase: string | null;
  cancellations: number;
  refunds: number;
};
export type CustomerReport = {
  generatedAt: string;
  mode: CustomerMode;
  baseCurrency: "USD";
  filters: Record<string, string | number | null>;
  total: number;
  rows: CustomerRow[];
  history: Array<{
    id: string;
    order_number: number;
    created_at: string;
    status: string;
    payment_status: string;
    total_micros: number;
    eligible: boolean;
  }>;
  metrics: {
    customers: number;
    buyers: number;
    repeat_buyers: number;
    new_buyers: number;
    returning_buyers: number;
    inactive_buyers: number;
    not_converted: number;
    purchases: number;
    spending: number;
    aov: number | null;
  };
  detail: {
    email: string | null;
    phone: string | null;
    address: string | null;
    contactSource: string;
  } | null;
};
export type AiCustomerIntelligenceWidget = CustomerReport & {
  id: string;
  kind: "customer_intelligence";
  initialVisibleRows: number;
};
