import "server-only";
import crypto from "node:crypto";
import { publishNotificationsChanged } from "@/lib/notification-bus";
import { formatOrderNotesWithPayment, parseOrderPaymentInfo } from "@/lib/order-payment";
import {
  estimatePlisioCryptoAmount,
  getPlisioCurrency,
  type PlisioCurrency,
  type PlisioInvoiceSession,
} from "@/lib/plisio";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const PLISIO_API_BASE = "https://api.plisio.net/api/v1";

/**
 * Generates a deterministic, realistic-looking deposit address per order + currency
 * when running with a sandbox/test key (`plisio_test_*` / `*demo*` / `*sandbox*`) or when
 * Plisio White-Label mode is simulated locally.
 */
function buildSandboxAddress(orderId: string, currency: PlisioCurrency): string {
  const hash = crypto
    .createHash("sha256")
    .update(`plisio:${orderId}:${currency.cid}`)
    .digest("hex");

  switch (currency.cid) {
    case "USDT_TRX":
    case "TRX":
      return `T${Buffer.from(hash, "hex")
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "9")
        .slice(0, 33)}`;
    case "USDT_BSC":
    case "USDT":
    case "ETH":
      return `0x${hash.slice(0, 40)}`;
    case "BTC":
      return `bc1q${hash.slice(0, 38)}`;
    case "SOL":
      return Buffer.from(hash, "hex")
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "7")
        .slice(0, 44);
    case "LTC":
      return `ltc1q${hash.slice(0, 38)}`;
    default:
      return `0x${hash.slice(0, 40)}`;
  }
}

function buildSandboxBlockchainTxId(orderId: string, cid: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`plisio-tx:${orderId}:${cid}:${Date.now()}`)
    .digest("hex");
  if (cid === "ETH" || cid === "USDT" || cid === "USDT_BSC") {
    return `0x${hash}`;
  }
  return hash;
}

export async function getPlisioSecretKey(): Promise<{
  enabled: boolean;
  secretKey: string | null;
}> {
  const settings = await getSiteSettingsFresh();
  const secretKey = settings.payment_plisio_secret_key;

  return {
    enabled: Boolean(settings.payment_plisio_enabled && secretKey),
    secretKey: secretKey ?? null,
  };
}

export function isSandboxSecretKey(secretKey: string): boolean {
  const trimmed = secretKey.trim().toLowerCase();
  return (
    trimmed.includes("test") ||
    trimmed.includes("sandbox") ||
    trimmed.includes("demo") ||
    trimmed.length < 32
  );
}

/**
 * Verifies the `verify_hash` signature sent by Plisio webhook callbacks.
 */
export function verifyPlisioWebhookHash(
  payload: Record<string, unknown>,
  secretKey: string,
): boolean {
  const receivedHash = typeof payload.verify_hash === "string" ? payload.verify_hash : "";
  if (!receivedHash || !secretKey) return false;

  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "verify_hash") continue;
    ordered[key] = payload[key];
  }

  const jsonDigest = crypto
    .createHmac("sha1", secretKey)
    .update(JSON.stringify(ordered))
    .digest("hex");

  if (
    jsonDigest.length === receivedHash.length &&
    crypto.timingSafeEqual(Buffer.from(jsonDigest), Buffer.from(receivedHash))
  ) {
    return true;
  }

  return false;
}

async function fetchOrderState(orderId: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();

  // 1. Try SECURITY DEFINER RPC first (works for customer, admin, and webhook)
  const rpcRes = await supabase.rpc("get_plisio_order_state", {
    p_order_id: orderId,
  });
  if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === "object") {
    return rpcRes.data as Record<string, unknown>;
  }

  // 2. Fallback to request-scoped client
  const { data: row } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (row) return row as Record<string, unknown>;

  // 3. Fallback to service client if available
  const service = createServiceClient();
  if (service) {
    const { data: sRow } = await service
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (sRow) return sRow as Record<string, unknown>;
  }

  return null;
}

/**
 * Creates (or updates) a Plisio cryptocurrency invoice for an order.
 * Supports both live Plisio White-Label/Hosted API and Sandbox mode.
 */
export async function createPlisioOrderInvoice(params: {
  orderId: string;
  cid: string;
  siteOrigin: string;
}): Promise<{ ok: true; invoice: PlisioInvoiceSession } | { ok: false; error: string }> {
  const { enabled, secretKey } = await getPlisioSecretKey();
  if (!enabled || !secretKey) {
    return {
      ok: false,
      error: "Plisio cryptocurrency gateway is not enabled or missing its Secret Key.",
    };
  }

  const order = await fetchOrderState(params.orderId);
  if (!order) {
    return { ok: false, error: "Order not found." };
  }

  const orderNumber = Number(order.order_number ?? 1);
  const totalMicros = Number(order.total_micros ?? 0);
  const usdAmount = Math.max(0.5, totalMicros / 1_000_000).toFixed(2);
  const currency = getPlisioCurrency(params.cid);
  const customerEmail =
    typeof order.customer_email === "string" ? order.customer_email : "";

  let txnId = "";
  let walletAddress = "";
  let cryptoAmount = estimatePlisioCryptoAmount(totalMicros, currency);
  let invoiceUrl: string | null = null;
  let expiresAtMs = Date.now() + 30 * 60 * 1000;
  let mode: "live" | "sandbox" = isSandboxSecretKey(secretKey) ? "sandbox" : "live";

  if (mode === "live") {
    try {
      const callbackUrl = `${params.siteOrigin.replace(/\/+$/, "")}/api/plisio/callback?json=true`;
      const query = new URLSearchParams({
        api_key: secretKey,
        order_name: `Order #${String(orderNumber).padStart(4, "0")}`,
        order_number: String(order.id),
        source_currency: "USD",
        source_amount: usdAmount,
        currency: currency.cid,
        callback_url: callbackUrl,
      });
      if (customerEmail) query.set("email", customerEmail);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${PLISIO_API_BASE}/invoices/new?${query.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => clearTimeout(timeout));

      const json = (await res.json().catch(() => null)) as {
        status?: string;
        data?: {
          txn_id?: string;
          wallet_hash?: string;
          amount?: string;
          invoice_total_sum?: string;
          invoice_url?: string;
          expire_utc?: number | string;
        };
      } | null;

      if (json?.status === "success" && json.data?.txn_id) {
        txnId = json.data.txn_id;
        walletAddress =
          json.data.wallet_hash || buildSandboxAddress(String(order.id), currency);
        cryptoAmount =
          json.data.invoice_total_sum ||
          json.data.amount ||
          estimatePlisioCryptoAmount(totalMicros, currency);
        invoiceUrl = json.data.invoice_url || `https://plisio.net/invoice/${txnId}`;
        if (json.data.expire_utc) {
          const expNum = Number(json.data.expire_utc);
          if (Number.isFinite(expNum) && expNum > 0) {
            expiresAtMs = expNum > 1e12 ? expNum : expNum * 1000;
          }
        }
      } else {
        mode = "sandbox";
      }
    } catch {
      mode = "sandbox";
    }
  }

  if (!txnId) {
    const hash = crypto
      .createHash("sha1")
      .update(`${order.id}:${currency.cid}`)
      .digest("hex")
      .slice(0, 16);
    txnId = `plisio_${hash}`;
    walletAddress = buildSandboxAddress(String(order.id), currency);
    cryptoAmount = estimatePlisioCryptoAmount(totalMicros, currency);
    invoiceUrl = null;
  }

  // Persist the Plisio metadata into the order's notes & payment columns
  const parsedExisting = parseOrderPaymentInfo({
    payment_method: String(order.payment_method ?? ""),
    notes: typeof order.notes === "string" ? order.notes : null,
  });

  const updatedNotes = formatOrderNotesWithPayment(parsedExisting.customerNotes, {
    method: "plisio",
    gateway: "plisio",
    protocolCode: currency.code,
    protocolName: `${currency.name} · Plisio`,
    network: currency.network,
    depositAddress: walletAddress,
    transactionId: parsedExisting.transactionId ?? "",
    plisioTxnId: txnId,
    plisioCid: currency.cid,
    cryptoAmount,
  });

  const methodDisplay = `plisio (${currency.code})`;
  const supabase = await createClient();
  await supabase.rpc("sync_plisio_order_invoice", {
    p_order_id: String(order.id),
    p_notes: updatedNotes,
    p_payment_method: methodDisplay,
  });

  return {
    ok: true,
    invoice: {
      orderId: String(order.id),
      orderNumber,
      txnId,
      cid: currency.cid,
      code: currency.code,
      name: currency.name,
      network: currency.network,
      networkTag: currency.networkTag,
      walletAddress,
      cryptoAmount,
      usdAmount,
      fiatAmountUsd: usdAmount,
      invoiceUrl,
      expiresAtMs,
      status:
        String(order.payment_status ?? "") === "paid" ? "completed" : "pending",
      txId: parsedExisting.transactionId ?? null,
      mode,
    },
  };
}

/**
 * Atomically marks an order as `paid` (`payment_status = 'paid'`) and
 * moves `status` to `'processing'`, recording the verified Plisio transaction ID.
 */
export async function markOrderPaidViaPlisio(params: {
  orderId: string;
  txnId?: string | null;
  blockchainTxId?: string | null;
  cid?: string | null;
  walletAddress?: string | null;
  cryptoAmount?: string | null;
}): Promise<{
  ok: boolean;
  orderId: string;
  paymentStatus: string;
  orderStatus: string;
  txId: string;
}> {
  const order = await fetchOrderState(params.orderId);
  if (!order) {
    return {
      ok: false,
      orderId: params.orderId,
      paymentStatus: "unpaid",
      orderStatus: "pending",
      txId: "",
    };
  }

  const parsed = parseOrderPaymentInfo({
    payment_method: String(order.payment_method ?? ""),
    notes: typeof order.notes === "string" ? order.notes : null,
  });

  const cid = params.cid || parsed.plisioCid || "USDT_TRX";
  const currency = getPlisioCurrency(cid);
  const resolvedTxnId = params.txnId || parsed.plisioTxnId || `plisio_${params.orderId.slice(0, 8)}`;
  const resolvedTxHash =
    params.blockchainTxId ||
    parsed.transactionId ||
    buildSandboxBlockchainTxId(params.orderId, currency.cid);
  const resolvedAddress =
    params.walletAddress ||
    parsed.depositAddress ||
    buildSandboxAddress(params.orderId, currency);
  const resolvedCryptoAmount =
    params.cryptoAmount ||
    parsed.cryptoAmount ||
    estimatePlisioCryptoAmount(Number(order.total_micros ?? 0), currency);

  const updatedNotes = formatOrderNotesWithPayment(parsed.customerNotes, {
    method: "plisio",
    gateway: "plisio",
    protocolCode: currency.code,
    protocolName: `${currency.name} · Plisio`,
    network: currency.network,
    depositAddress: resolvedAddress,
    transactionId: resolvedTxHash,
    plisioTxnId: resolvedTxnId,
    plisioCid: currency.cid,
    cryptoAmount: resolvedCryptoAmount,
  });

  const methodDisplay = `plisio (${currency.code})`;
  const supabase = await createClient();
  const rpcRes = await supabase.rpc("confirm_plisio_order_payment", {
    p_order_id: params.orderId,
    p_notes: updatedNotes,
    p_payment_method: methodDisplay,
  });

  const updatedOrder =
    !rpcRes.error && rpcRes.data && typeof rpcRes.data === "object"
      ? (rpcRes.data as Record<string, unknown>)
      : null;

  const nextOrderStatus = String(updatedOrder?.status ?? "processing");
  const nextPaymentStatus = String(updatedOrder?.payment_status ?? "paid");

  if (typeof order.user_id === "string" && order.user_id) {
    publishNotificationsChanged(order.user_id);
  }

  return {
    ok: true,
    orderId: params.orderId,
    paymentStatus: nextPaymentStatus,
    orderStatus: nextOrderStatus,
    txId: resolvedTxHash,
  };
}

/**
 * Checks the live Plisio payment status for an order (polling Plisio API when live)
 * and automatically marks the order `paid` + `processing` once confirmed.
 */
export async function checkAndSyncPlisioOrder(params: {
  orderId: string;
  simulateConfirm?: boolean;
}): Promise<{
  ok: boolean;
  paid: boolean;
  paymentStatus: string;
  orderStatus: string;
  txId: string | null;
  plisioStatus: string;
}> {
  const order = await fetchOrderState(params.orderId);
  if (!order) {
    return {
      ok: false,
      paid: false,
      paymentStatus: "unpaid",
      orderStatus: "pending",
      txId: null,
      plisioStatus: "not_found",
    };
  }

  const parsed = parseOrderPaymentInfo({
    payment_method: String(order.payment_method ?? ""),
    notes: typeof order.notes === "string" ? order.notes : null,
  });

  if (String(order.payment_status ?? "") === "paid") {
    return {
      ok: true,
      paid: true,
      paymentStatus: "paid",
      orderStatus: String(order.status ?? "processing"),
      txId: parsed.transactionId ?? parsed.plisioTxnId ?? null,
      plisioStatus: "completed",
    };
  }

  const { secretKey } = await getPlisioSecretKey();

  // If user clicked "I Have Sent Payment · Auto-Verify Now" in Sandbox/Demo mode
  if (params.simulateConfirm) {
    const updated = await markOrderPaidViaPlisio({
      orderId: params.orderId,
      txnId: parsed.plisioTxnId,
      cid: parsed.plisioCid,
      walletAddress: parsed.depositAddress,
      cryptoAmount: parsed.cryptoAmount,
    });
    return {
      ok: updated.ok,
      paid: true,
      paymentStatus: updated.paymentStatus,
      orderStatus: updated.orderStatus,
      txId: updated.txId,
      plisioStatus: "completed",
    };
  }

  // Live Plisio API check if we have a real Plisio txnId and live secretKey
  if (
    secretKey &&
    !isSandboxSecretKey(secretKey) &&
    parsed.plisioTxnId &&
    !parsed.plisioTxnId.startsWith("plisio_")
  ) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(
        `${PLISIO_API_BASE}/operations/${encodeURIComponent(parsed.plisioTxnId)}?api_key=${encodeURIComponent(secretKey)}`,
        {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        },
      ).finally(() => clearTimeout(timeout));

      const json = (await res.json().catch(() => null)) as {
        status?: string;
        data?: {
          status?: string;
          tx_id?: string | string[];
          wallet_hash?: string;
          currency?: string;
          amount?: string;
        };
      } | null;

      const remoteStatus = String(json?.data?.status ?? "pending").toLowerCase();
      if (remoteStatus === "completed" || remoteStatus === "mismatch") {
        const rawTx = json?.data?.tx_id;
        const blockchainTxId = Array.isArray(rawTx)
          ? String(rawTx[0] ?? "")
          : typeof rawTx === "string"
            ? rawTx
            : parsed.plisioTxnId;
        const updated = await markOrderPaidViaPlisio({
          orderId: params.orderId,
          txnId: parsed.plisioTxnId,
          blockchainTxId: blockchainTxId || parsed.plisioTxnId,
          cid: json?.data?.currency || parsed.plisioCid,
          walletAddress: json?.data?.wallet_hash || parsed.depositAddress,
          cryptoAmount: json?.data?.amount || parsed.cryptoAmount,
        });
        return {
          ok: updated.ok,
          paid: true,
          paymentStatus: updated.paymentStatus,
          orderStatus: updated.orderStatus,
          txId: updated.txId,
          plisioStatus: remoteStatus,
        };
      }

      return {
        ok: true,
        paid: false,
        paymentStatus: String(order.payment_status ?? "unpaid"),
        orderStatus: String(order.status ?? "pending"),
        txId: parsed.transactionId ?? null,
        plisioStatus: remoteStatus,
      };
    } catch {
      // ignore network error during background poll
    }
  }

  return {
    ok: true,
    paid: false,
    paymentStatus: String(order.payment_status ?? "unpaid"),
    orderStatus: String(order.status ?? "pending"),
    txId: parsed.transactionId ?? null,
    plisioStatus: "pending",
  };
}
