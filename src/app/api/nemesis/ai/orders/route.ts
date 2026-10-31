import { NextResponse } from "next/server";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { readOrders } from "@/lib/ai/orders/service";
import type { OrderReportMode } from "@/lib/ai/orders/types";

export const maxDuration = 30;

/** Dashboard drill-down/pagination is read-only and does not spend model tokens. */
export async function POST(request: Request) {
  try {
    await assertAdmin();
    const body = await request.json();
    const mode = body.mode as OrderReportMode;
    if (!["search", "detail", "report", "customers", "problems"].includes(mode) || !body.filters || typeof body.filters !== "object" || Array.isArray(body.filters)) {
      return NextResponse.json({ ok: false, error: "Invalid order report request." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, report: await readOrders(body.filters, mode) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Report unavailable." }, { status: error instanceof AdminAuthError ? 403 : 400 });
  }
}
