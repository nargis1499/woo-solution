import "server-only";
import crypto from "node:crypto";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
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
 * Generates a deterministic test deposit address per order + currency
 * ONLY when Admin has explicitly enabled Test Mode (`payment_plisio_test_mode = true`).
 */
function buildTestModeAddress(orderId: string, currency: PlisioCurrency): string {
  const hash = crypto
    .createHash("sha256")
    .update(`plisio-test:${orderId}:${currency.cid}`)
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

function buildTestModeBlockchainTxId(orderId: string, cid: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`plisio-test-tx:${orderId}:${cid}:${Date.now()}`)
    .digest("hex");
  if (cid === "ETH" || cid === "USDT" || cid === "USDT_BSC") {
    return `0x${hash}`;
  }
  return hash;
}

export async function getPlisioSecretKey(): Promise<{
  enabled: boolean;
  testMode: boolean;
  isAdmin: boolean;
  secretKey: string | null;
}> {
  const [settings, isAdmin] = await Promise.all([
    getSiteSettingsFresh(),
    isCurrentUserAdmin().catch(() => false),
  ]);
  const secretKey = settings.payment_plisio_secret_key;
  // Test Mode simulation is strictly locked to Admin accounts only;
  // regular customers ALWAYS run in real live Plisio mode.
  const testMode = Boolean(settings.payment_plisio_test_mode && isAdmin);

  return {
    enabled: Boolean(settings.payment_plisio_enabled && (secretKey || testMode)),
    testMode,
    isAdmin,
    secretKey: secretKey ?? null,
  };
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
 * - When `testMode === false` (Live Mode): Strictly calls `api.plisio.net/api/v1/invoices/new`.
 *   Never generates a fake deposit address or fake invoice.
 * - When `testMode === true` (Test Mode): Generates a sandbox test invoice so Admin can
 *   test the checkout flow and simulate confirmations without real crypto.
 */
export async function createPlisioOrderInvoice(params: {
  orderId: string;
  cid: string;
  siteOrigin: string;
}): Promise<{ ok: true; invoice: PlisioInvoiceSession } | { ok: false; error: string }> {
  const { enabled, testMode, secretKey } = await getPlisioSecretKey();
  if (!enabled) {
    return {
      ok: false,
      error: "Plisio cryptocurrency gateway is not enabled.",
    };
  }

  if (!testMode && !secretKey) {
    return {
      ok: false,
      error: "Plisio Secret Key is required when Test Mode is disabled.",
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
  const mode: "live" | "sandbox" = testMode ? "sandbox" : "live";

  if (mode === "live" && secretKey) {
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
      const timeout = setTimeout(() => controller.abort(), 10000);
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
          message?: string;
        };
      } | null;

      if (json?.status !== "success" || !json.data?.txn_id) {
        return {
          ok: false,
          error:
            json?.data?.message ||
            "Plisio rejected invoice creation. Please check your Plisio Secret Key and ensure the selected coin is enabled in your Plisio Shop.",
        };
      }

      txnId = json.data.txn_id;
      walletAddress = json.data.wallet_hash || "";
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
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? `Could not reach Plisio API: ${e.message}`
            : "Could not reach Plisio API to create live invoice.",
      };
    }
  } else {
    // Test Mode is explicitly enabled by Admin
    const hash = crypto
      .createHash("sha1")
      .update(`${order.id}:${currency.cid}`)
      .digest("hex")
      .slice(0, 16);
    txnId = `plisio_test_${hash}`;
    walletAddress = buildTestModeAddress(String(order.id), currency);
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
  const resolvedTxnId =
    params.txnId || parsed.plisioTxnId || `plisio_${params.orderId.slice(0, 8)}`;
  const resolvedTxHash =
    params.blockchainTxId ||
    parsed.transactionId ||
    resolvedTxnId;
  const resolvedAddress =
    params.walletAddress ||
    parsed.depositAddress ||
    "";
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
 * Checks the live Plisio payment status for an order (polling Plisio API when Test Mode is disabled)
 * and automatically marks the order `paid` + `processing` ONLY when confirmed on-chain
 * (or when `simulateConfirm` is triggered while `testMode === true`).
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
  error?: string;
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
      error: "Order not found.",
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

  const { testMode, secretKey } = await getPlisioSecretKey();

  // If caller requested a simulated payment confirmation:
  if (params.simulateConfirm) {
    if (!testMode) {
      // Strictly reject fake/simulated confirmation when Test Mode is disabled!
      return {
        ok: false,
        paid: false,
        paymentStatus: String(order.payment_status ?? "unpaid"),
        orderStatus: String(order.status ?? "pending"),
        txId: null,
        plisioStatus: "test_mode_disabled",
        error:
          "Test Mode is disabled. Payments are only marked Paid when confirmed on the blockchain via Plisio.",
      };
    }

    const cid = parsed.plisioCid || "USDT_TRX";
    const simulatedTxHash = buildTestModeBlockchainTxId(params.orderId, cid);
    const simulatedTxnId =
      parsed.plisioTxnId && parsed.plisioTxnId.startsWith("plisio_test_")
        ? parsed.plisioTxnId
        : `plisio_test_${parsed.plisioTxnId || params.orderId.slice(0, 12)}`;
    const updated = await markOrderPaidViaPlisio({
      orderId: params.orderId,
      txnId: simulatedTxnId,
      blockchainTxId: simulatedTxHash,
      cid,
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

  // Live Plisio API verification when Test Mode is disabled (or when a real Plisio invoice exists)
  if (
    secretKey &&
    parsed.plisioTxnId &&
    !parsed.plisioTxnId.startsWith("plisio_test_")
  ) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
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

      const remoteStatus = String(json?.data?.status ?? "new").toLowerCase();
      if (remoteStatus === "completed" || remoteStatus === "mismatch") {
        const rawTx = json?.data?.tx_id;
        const blockchainTxId = Array.isArray(rawTx)
          ? String(rawTx[0] ?? "")
          : typeof rawTx === "string" && rawTx.trim()
            ? rawTx.trim()
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
    plisioStatus: "new",
  };
}
