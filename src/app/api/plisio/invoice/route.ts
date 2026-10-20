import { NextResponse, type NextRequest } from "next/server";
import { createPlisioOrderInvoice } from "@/lib/plisio.server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      cid?: string;
    };

    const orderId = String(body.orderId ?? "").trim();
    const cid = String(body.cid ?? "USDT_TRX").trim() || "USDT_TRX";

    if (!UUID_RE.test(orderId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid orderId" },
        { status: 400 },
      );
    }

    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      new URL(request.url).origin;

    const result = await createPlisioOrderInvoice({
      orderId,
      cid,
      siteOrigin: origin,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create Plisio invoice";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
