import "server-only";
import { assertAdmin } from "@/lib/admin/auth";
import { UUID_RE } from "@/lib/admin/form";
import { createClient } from "@/lib/supabase/server";
import { type Money } from "@/lib/money";
import type { OrderReport, OrderReportMode } from "./types";

const statuses: Record<string, string[]> = {
  status: ["pending", "processing", "completed", "cancelled", "refunded"],
  paymentStatus: ["unpaid", "paid", "refunded"],
  fulfillmentStatus: ["unknown", "unfulfilled", "packed", "shipped", "delivered"],
  shippingStatus: ["unknown", "pending", "in_transit", "delayed", "delivered"],
};
const strings = ["customer", "email", "product"];
const dates = ["from", "to", "cursorAt"];
const integers: Record<string, [number, number]> = {
  orderNumber: [1, Number.MAX_SAFE_INTEGER], limit: [1, 50], minQuantity: [1, 1000000], maxQuantity: [1, 1000000],
  processingHours: [1, 720], fulfillmentHours: [1, 720], paymentHours: [1, 720], highQuantity: [1, 1000000], inactiveDays: [1, 3650],
  minValueMicros: [0, Number.MAX_SAFE_INTEGER], maxValueMicros: [0, Number.MAX_SAFE_INTEGER], highValueMicros: [0, Number.MAX_SAFE_INTEGER],
  cursorSeverity: [0, 1],
};

/** Whitelist every filter on server, including follow-up dashboard pagination calls. */
export function orderFilters(input: Record<string, unknown>, mode: OrderReportMode, money?: Money): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, allowed] of Object.entries(statuses)) {
    if (input[key] == null || input[key] === "") continue;
    if (typeof input[key] !== "string" || !allowed.includes(input[key])) throw new Error(`Invalid ${key}.`);
    out[key] = input[key];
  }
  if (out.status === "refunded") { delete out.status; out.paymentStatus = "refunded"; }
  for (const key of strings) {
    if (input[key] == null || input[key] === "") continue;
    if (typeof input[key] !== "string" || input[key].trim().length > 200) throw new Error(`Invalid ${key}.`);
    out[key] = input[key].trim();
  }
  for (const key of ["id", "customerId", "customerOrderId", "cursorId"]) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "string" || !UUID_RE.test(input[key])) throw new Error(`Invalid ${key}.`);
    out[key] = input[key];
  }
  for (const key of dates) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "string" || !Number.isFinite(Date.parse(input[key]))) throw new Error(`Invalid ${key}.`);
    out[key] = new Date(input[key]).toISOString();
  }
  for (const [key, [min, max]] of Object.entries(integers)) {
    if (input[key] == null) continue;
    const value = Number(input[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}.`);
    out[key] = value;
  }
  for (const key of ["inactiveOnly", "repeatOnly", "highRiskOnly", "includeCombinations"]) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "boolean") throw new Error(`Invalid ${key}.`);
    out[key] = input[key];
  }
  // Model-facing values are in the store's display currency; database/report values are USD micros.
  for (const [inputKey, outputKey] of [["minValue", "minValueMicros"], ["maxValue", "maxValueMicros"], ["highValue", "highValueMicros"]]) {
    if (input[inputKey] == null) continue;
    const value = Number(input[inputKey]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${inputKey}.`);
    const micros = Math.round(value * 1000000 / (money?.rate ?? 1));
    if (!Number.isSafeInteger(micros)) throw new Error("Order value is too large.");
    out[outputKey] = micros;
  }
  if ((out.cursorAt == null) !== (out.cursorId == null)) throw new Error("Incomplete page cursor.");
  const now = new Date();
  out.to ??= now.toISOString();
  if (mode === "report") out.from ??= new Date(now.getTime() - 30 * 86400000).toISOString();
  if (mode === "customers") out.from ??= "1970-01-01T00:00:00.000Z";
  if (mode === "problems") out.from ??= new Date(now.getTime() - 90 * 86400000).toISOString();
  if (out.from && String(out.from) >= String(out.to)) throw new Error("Start must precede end (exclusive, UTC).");
  if (out.minValueMicros != null && out.maxValueMicros != null && Number(out.minValueMicros) > Number(out.maxValueMicros)) throw new Error("Minimum value exceeds maximum.");
  if (out.minQuantity != null && out.maxQuantity != null && Number(out.minQuantity) > Number(out.maxQuantity)) throw new Error("Minimum quantity exceeds maximum.");
  out.processingHours ??= 72;
  out.fulfillmentHours ??= 48;
  out.paymentHours ??= 24;
  out.highQuantity ??= 20;
  out.highValueMicros ??= 1000000000;
  if (mode === "customers" || mode === "report") out.inactiveDays ??= 90;
  if (mode === "customers") out.includeCombinations ??= false;
  out.limit ??= mode === "detail" ? 1 : 20;
  return out;
}

export async function readOrders(input: Record<string, unknown>, mode: OrderReportMode, money?: Money): Promise<OrderReport> {
  await assertAdmin();
  const filters = orderFilters(input, mode, money);
  if (mode === "detail" && !filters.id && !filters.orderNumber) throw new Error("Provide an exact order ID or number.");
  const db = await createClient();
  if (filters.customerOrderId) {
    // Resolve the requested identity once so the database can use its user/email indexes,
    // rather than evaluating a correlated customer predicate across the entire store.
    const { data: anchor, error: anchorError } = await db.from("orders").select("id,user_id,customer_email").eq("id", filters.customerOrderId).maybeSingle();
    if (anchorError) throw new Error(anchorError.message);
    if (!anchor) throw new Error("Customer anchor order no longer exists.");
    if (anchor.user_id) filters.customerId ??= anchor.user_id;
    else if (anchor.customer_email) filters.email ??= anchor.customer_email;
    else filters.id ??= anchor.id;
  }
  const { data, error } = await db.rpc("nemesis_orders_read", { p: filters, p_mode: mode });
  if (error?.code === "PGRST202") throw new Error("Order Intelligence needs its database migration: 20261051000000_order_intelligence.sql. No order changes were made.");
  if (error) throw new Error(`Order report unavailable: ${error.message}. For large collections, narrow the dates/filters; no partial totals are reported.`);
  return data as OrderReport;
}
