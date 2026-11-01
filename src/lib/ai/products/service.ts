import "server-only";
import { assertAdmin } from "@/lib/admin/auth";
import { toDisplayMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { productFilters } from "./filters";
import type { ProductQueryReport } from "./types";
export async function readProducts(
  input: Record<string, unknown>,
): Promise<ProductQueryReport> {
  await assertAdmin();
  const filters = productFilters(input);
  if (filters.scope === "products" && filters.variationStatus !== "active")
    throw new Error("variationStatus only applies to variation scope.");
  const db = await createClient();
  const { data, error } = await db
    .rpc("nemesis_products_read", { p: filters })
    .abortSignal(AbortSignal.timeout(20000));
  if (error?.code === "PGRST202")
    throw new Error(
      "Product queries require migration 20261058000000_product_queries.sql.",
    );
  if (error) {
    if (error.code === "P0001") throw new Error(error.message);
    throw new Error(
      "Product query unavailable; no partial totals are shown. Check filters or database configuration.",
    );
  }
  if (!data || !Array.isArray(data.rows))
    throw new Error("Product query returned no valid report.");
  const report = data as ProductQueryReport;
  for (const n of [
    report.total,
    ...Object.values(report.metrics),
    ...report.rows.flatMap((row) => [
      row.price_micros,
      row.compare_at_price_micros,
      row.stock,
    ]),
  ]) {
    if (n != null && !Number.isSafeInteger(n))
      throw new Error(
        "Product report exceeds supported numeric precision; narrow the filters.",
      );
  }
  for (const row of report.rows) {
    for (const amount of [row.price_micros, row.compare_at_price_micros]) {
      if (
        amount != null &&
        !Number.isSafeInteger(toDisplayMinor(amount, report.money))
      ) {
        throw new Error(
          "Displayed prices exceed supported numeric precision; narrow the filters or use USD.",
        );
      }
    }
  }
  return { ...report, filters };
}
