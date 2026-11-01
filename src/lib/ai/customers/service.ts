import "server-only";
import { assertAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CUSTOMER_TOOL_MODES,
  type CustomerMode,
  type CustomerReport,
  type CustomerToolName,
} from "./types";

export async function readCustomers(
  input: Record<string, unknown>,
  mode: CustomerMode,
): Promise<CustomerReport> {
  await assertAdmin();
  if (!Object.values(CUSTOMER_TOOL_MODES).includes(mode))
    throw new Error("Unknown customer report.");
  const filters: Record<string, string | number> = {};
  for (const [key, min, max] of [
    ["limit", 1, 50],
    ["page", 1, 10000],
    ["inactiveDays", 1, 3650],
    ["minPurchases", 0, 100000],
  ] as const) {
    if (input[key] == null) continue;
    const n = Number(input[key]);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`Invalid ${key}.`);
    filters[key] = n;
  }
  for (const key of ["from", "to"] as const) {
    if (input[key] == null) continue;
    if (
      typeof input[key] !== "string" ||
      !Number.isFinite(Date.parse(input[key] as string))
    )
      throw new Error(`Invalid ${key} date.`);
    filters[key] = new Date(input[key] as string).toISOString();
  }
  for (const key of ["customerKey", "search", "sort"] as const) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "string") throw new Error(`Invalid ${key}.`);
    const text = (input[key] as string).trim();
    if (text.length > (key === "search" ? 120 : 100))
      throw new Error(`Invalid ${key} length.`);
    filters[key] = key === "customerKey" ? text.toLowerCase() : text;
  }
  if (input.customerId != null) {
    if (
      typeof input.customerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.customerId,
      )
    )
      throw new Error("Invalid customer ID.");
    const key = `u:${input.customerId.toLowerCase()}`;
    if (filters.customerKey && filters.customerKey !== key)
      throw new Error("Conflicting customer identities.");
    filters.customerKey = key;
  }
  if (mode === "details") {
    filters.page = 1;
    filters.limit = 1;
  }
  const db = await createClient();
  const { data, error } = await db
    .rpc("nemesis_customers_read", { p: filters, p_mode: mode })
    .abortSignal(AbortSignal.timeout(20000));
  if (error?.code === "PGRST202")
    throw new Error(
      "Customer Intelligence requires migration 20261057000000_customer_intelligence.sql.",
    );
  if (error)
    throw new Error(
      "Customer report unavailable. Check its filters or database migration; no partial totals are shown.",
    );
  return data as CustomerReport;
}
export function isCustomerTool(name: string): name is CustomerToolName {
  return Object.prototype.hasOwnProperty.call(CUSTOMER_TOOL_MODES, name);
}
