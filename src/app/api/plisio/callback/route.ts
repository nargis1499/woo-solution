import { NextResponse, type NextRequest } from "next/server";
import {
  getPlisioSecretKey,
  markOrderPaidViaPlisio,
  verifyPlisioWebhookHash,
} from "@/lib/plisio.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/plisio/callback — Official Plisio Webhook / Status URL endpoint.
 *
 * Accepts both JSON (`?json=true`) and `multipart/form-data` / `application/x-www-form-urlencoded`
 * callbacks from Plisio. Verifies `verify_hash` with the Admin's Plisio Secret Key and
 * automatically marks the order `payment_status = 'paid'` and `status = 'processing'` when
 * the blockchain payment status is `completed` or `mismatch` (overpaid).
 */
export async function POST(request: NextRequest) {
  try {
    const { enabled, secretKey } = await getPlisioSecretKey();
    if (!enabled || !secretKey) {
      return NextResponse.json(
        { ok: false, error: "Plisio gateway is not active" },
        { status: 400 },
      );
    }

    let payload: Record<string, unknown> = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = ((await request.json().catch(() => ({}))) ?? {}) as Record<
        string,
        unknown
      >;
    } else {
      const formData = await request.formData().catch(() => null);
      if (formData) {
        formData.forEach((value, key) => {
          payload[key] = typeof value === "string" ? value : String(value);
        });
      }
    }

    if (!verifyPlisioWebhookHash(payload, secretKey)) {
      return NextResponse.json(
        { ok: false, error: "Invalid verify_hash signature" },
        { status: 401 },
      );
    }

    const orderId = String(payload.order_number ?? "").trim();
    const status = String(payload.status ?? "").trim().toLowerCase();
    const txnId = String(payload.txn_id ?? "").trim() || null;
    const cid = String(payload.currency ?? "").trim() || null;
    const walletAddress = String(payload.wallet_hash ?? "").trim() || null;
    const cryptoAmount = String(payload.amount ?? "").trim() || null;

    let blockchainTxId = txnId;
    if (typeof payload.tx_id === "string" && payload.tx_id.trim()) {
      blockchainTxId = payload.tx_id.trim();
    } else if (Array.isArray(payload.tx_id) && payload.tx_id.length > 0) {
      blockchainTxId = String(payload.tx_id[0]);
    }

    if (!UUID_RE.test(orderId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid order_number" },
        { status: 400 },
      );
    }

    if (status === "completed" || status === "mismatch") {
      const updated = await markOrderPaidViaPlisio({
        orderId,
        txnId,
        blockchainTxId,
        cid,
        walletAddress,
        cryptoAmount,
      });
      return NextResponse.json({
        ok: updated.ok,
        status: "paid_and_processing",
        orderId: updated.orderId,
      });
    }

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Webhook processing error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
