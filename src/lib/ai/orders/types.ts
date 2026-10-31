import type { Order, OrderItem } from "@/lib/types";

export type OrderFlag = { severity: "high" | "medium"; reason: string; next: string };
export type OrderRow = Pick<Order, "id" | "order_number" | "status" | "payment_method" | "payment_status" | "shipping_name" | "total_micros" | "created_at"> & Partial<Order> & {
  updated_at: string;
  fulfillment_status: string;
  shipping_status: string;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipping_carrier?: string | null;
  paid_at?: string | null;
  fulfilled_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  fulfillment_due_at?: string | null;
  expected_delivery_at?: string | null;
  refund_request_status?: string;
  refund_requested_at?: string | null;
  quantity: number;
  flags: OrderFlag[];
  items?: OrderItem[];
  timelineCount?: number;
  timeline?: Array<{ id: string; event: string; message: string; success: boolean; created_at: string }>;
};
export type OrderMetrics = {
  orders: number; paidOrders: number; revenueMicros: number; aovMicros: number;
  cancelled: number; refunded: number; unpaid: number;
  statusCounts: Record<string, number> | null;
  paymentCounts: Record<string, number> | null;
  fulfillmentCounts: Record<string, number> | null;
  repeatCustomers: number; oneTimeCustomers: number; inactiveCustomers: number;
  cohortCustomers: number; cohortSpendingMicros: number; cohortOrders: number; cohortPurchases: number;
  previousOrders: number; previousRevenueMicros: number;
};
export type OrderCustomer = {
  key: string; sample_order_id: string; name: string; orders: number; purchases: number; spending: number;
  cancellations: number; refunds: number; last_order: string; first_order: string;
  last_purchase: string | null; frequency_days: number | null;
};
export type OrderReportMode = "search" | "detail" | "report" | "customers" | "problems";
export type OrderReport = {
  generatedAt: string;
  mode: OrderReportMode;
  filters: Record<string, string | number | boolean>;
  baseCurrency: "USD";
  total: number;
  rows: OrderRow[];
  hasMore: boolean;
  metrics: OrderMetrics | null;
  topProducts: Array<{ key: string; name: string; units: number; sales: number }>;
  highestRevenueProducts: Array<{ key: string; name: string; units: number; sales: number }>;
  customers: OrderCustomer[];
  daily: Array<{ day: string; orders: number; revenue: number }>;
  combinations: Array<{ first: string; second: string; orders: number }>;
};
export type OrderOperation = "status" | "refund_request" | "note" | "notification" | "fulfillment" | "shipping";
export type AiOrderIntelligenceWidget = OrderReport & {
  id: string; kind: "order_intelligence"; initialVisibleRows: number;
};
