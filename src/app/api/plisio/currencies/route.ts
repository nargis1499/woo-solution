import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import { fetchPlisioCurrenciesFromApi } from "@/lib/plisio.server";
import { savePaymentSettings } from "@/app/nemesis/actions";

export async function POST(request: NextRequest) {
  try {
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { ok: false, error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      secretKey?: string;
    };

    const synced = await fetchPlisioCurrenciesFromApi(body.secretKey ?? null);
    if (!synced.ok) {
      return NextResponse.json(synced, { status: 400 });
    }

    await savePaymentSettings({
      payment_plisio_currencies: synced.currencies,
      ...(body.secretKey ? { payment_plisio_secret_key: body.secretKey } : {}),
    });

    return NextResponse.json({
      ok: true,
      currencies: synced.currencies,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to sync Plisio currencies";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
