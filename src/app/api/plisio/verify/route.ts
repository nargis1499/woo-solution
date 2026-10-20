import { NextResponse, type NextRequest } from "next/server";
import { checkAndSyncPlisioOrder } from "@/lib/plisio.server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = (searchParams.get("orderId") ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ ok: false, error: "Invalid orderId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const status = await checkAndSyncPlisioOrder({ orderId });
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      simulateConfirm?: boolean;
    };
    const orderId = String(body.orderId ?? "").trim();
    if (!UUID_RE.test(orderId)) {
      return NextResponse.json({ ok: false, error: "Invalid orderId" }, { status: 400 });
    }

    const status = await checkAndSyncPlisioOrder({
      orderId,
      simulateConfirm: Boolean(body.simulateConfirm),
    });

    return NextResponse.json(status);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to verify payment";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
