import { shortNetworkTag } from "./crypto-protocols";
import type { Order } from "./types";

export type OrderPaymentInput = {
  method: "cod" | "crypto" | "plisio" | "stripe";
  gateway?: "plisio" | "manual" | "stripe";
  protocolCode?: string;
  protocolName?: string;
  network?: string;
  depositAddress?: string;
  transactionId?: string;
  plisioTxnId?: string;
  plisioCid?: string;
  cryptoAmount?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
};

export type ParsedOrderPayment = {
  isCrypto: boolean;
  isPlisio: boolean;
  isStripe: boolean;
  isTestMode: boolean;
  methodLabel: string;
  shortMethodLabel: string;
  protocolCode: string | null;
  protocolName: string | null;
  network: string | null;
  depositAddress: string | null;
  transactionId: string | null;
  plisioTxnId: string | null;
  plisioCid: string | null;
  cryptoAmount: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  customerNotes: string | null;
};

const PAYMENT_META_PREFIX = "[PAYMENT_META:";
const PAYMENT_META_SUFFIX = "]";

type EncodedPaymentMeta = {
  m?: "crypto" | "cod" | "plisio" | "stripe";
  g?: "plisio" | "manual" | "stripe";
  c?: string;
  p?: string;
  n?: string;
  a?: string;
  tx?: string;
  ptx?: string;
  cid?: string;
  amt?: string;
  cs?: string;
  pi?: string;
};

/**
 * Attaches structured payment metadata to `notes` so that even if a database
 * does not yet have the optional `payment_*` columns, the Admin Order page and
 * Customer Order page can always parse the full payment protocol, network,
 * deposit address, Plisio invoice ID, and Transaction ID (TXID), while keeping
 * customer notes clean.
 */
export function formatOrderNotesWithPayment(
  rawCustomerNotes: string | null | undefined,
  payment?: OrderPaymentInput | null,
): string {
  const cleanNotes = (rawCustomerNotes ?? "").trim();
  if (!payment || payment.method === "cod") {
    return cleanNotes;
  }

  const isPlisio = payment.method === "plisio" || payment.gateway === "plisio";
  const isStripe = payment.method === "stripe" || payment.gateway === "stripe";

  const meta: EncodedPaymentMeta = {
    m: isStripe ? "stripe" : isPlisio ? "plisio" : "crypto",
    g: isStripe ? "stripe" : isPlisio ? "plisio" : undefined,
    c: payment.protocolCode?.trim() || undefined,
    p: payment.protocolName?.trim() || (isStripe ? "Stripe Checkout" : undefined),
    n: payment.network?.trim() || undefined,
    a: payment.depositAddress?.trim() || undefined,
    tx: payment.transactionId?.trim() || payment.stripePaymentIntentId?.trim() || undefined,
    ptx: payment.plisioTxnId?.trim() || undefined,
    cid: payment.plisioCid?.trim() || undefined,
    amt: payment.cryptoAmount?.trim() || undefined,
    cs: payment.stripeCheckoutSessionId?.trim() || undefined,
    pi: payment.stripePaymentIntentId?.trim() || undefined,
  };

  const tag = `${PAYMENT_META_PREFIX}${JSON.stringify(meta)}${PAYMENT_META_SUFFIX}`;
  return cleanNotes ? `${cleanNotes}\n${tag}` : tag;
}

/**
 * Extracts structured payment information and clean customer notes from an Order.
 */
export function parseOrderPaymentInfo(
  order: Pick<
    Order,
    | "payment_method"
    | "notes"
    | "payment_protocol"
    | "payment_network"
    | "payment_address"
    | "payment_tx_id"
    | "stripe_checkout_session_id"
    | "stripe_payment_intent_id"
  >,
): ParsedOrderPayment {
  let rawNotes = order.notes ?? "";
  let meta: EncodedPaymentMeta | null = null;

  // 1. Parse `[PAYMENT_META:{...}]` if present
  const metaStart = rawNotes.indexOf(PAYMENT_META_PREFIX);
  if (metaStart !== -1) {
    const metaEnd = rawNotes.lastIndexOf(PAYMENT_META_SUFFIX);
    if (metaEnd > metaStart) {
      const jsonStr = rawNotes.slice(metaStart + PAYMENT_META_PREFIX.length, metaEnd);
      try {
        meta = JSON.parse(jsonStr) as EncodedPaymentMeta;
        rawNotes = (
          rawNotes.slice(0, metaStart) + rawNotes.slice(metaEnd + PAYMENT_META_SUFFIX.length)
        ).trim();
      } catch {
        // ignore malformed JSON
      }
    }
  }

  // 2. Also support legacy `[Crypto Payment: USDT (TRON TRC20) | TXID: ...]` lines
  const legacyRegex = /\[Crypto Payment:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|\s*TXID:\s*([^\]]+)\]/i;
  const legacyMatch = legacyRegex.exec(rawNotes);
  if (legacyMatch) {
    if (!meta) {
      meta = {
        m: "crypto",
        c: legacyMatch[1]?.trim(),
        p: legacyMatch[1]?.trim(),
        n: legacyMatch[2]?.trim(),
        tx: legacyMatch[3]?.trim(),
      };
    }
    rawNotes = rawNotes.replace(legacyRegex, "").trim();
  }

  const methodRaw = (order.payment_method ?? "cod").trim();
  const stripeCheckoutSessionId = order.stripe_checkout_session_id || meta?.cs || null;
  const stripePaymentIntentId =
    order.stripe_payment_intent_id || meta?.pi || (/^stripe/i.test(methodRaw) ? order.payment_tx_id || meta?.tx || null : null);
  const isStripe = Boolean(
    meta?.m === "stripe" ||
      meta?.g === "stripe" ||
      /^stripe/i.test(methodRaw) ||
      /stripe/i.test(order.payment_protocol ?? "") ||
      stripeCheckoutSessionId ||
      stripePaymentIntentId,
  );

  if (isStripe) {
    const network =
      order.payment_network ||
      meta?.n ||
      (stripeCheckoutSessionId?.startsWith("cs_test_") ? "Test mode" : stripeCheckoutSessionId ? "Live mode" : null);
    const isStripeTestMode = /test/i.test(network ?? "") || Boolean(stripeCheckoutSessionId?.startsWith("cs_test_"));
    return {
      isCrypto: false,
      isPlisio: false,
      isStripe: true,
      isTestMode: isStripeTestMode,
      methodLabel: `Stripe Checkout${isStripeTestMode ? " (Test mode)" : ""}`,
      shortMethodLabel: isStripeTestMode ? "STRIPE [TEST]" : "STRIPE",
      protocolCode: "stripe",
      protocolName: "Stripe Checkout",
      network,
      depositAddress: null,
      transactionId: stripePaymentIntentId,
      plisioTxnId: null,
      plisioCid: null,
      cryptoAmount: null,
      stripeCheckoutSessionId,
      stripePaymentIntentId,
      customerNotes: rawNotes || null,
    };
  }

  const isPlisio =
    meta?.m === "plisio" ||
    meta?.g === "plisio" ||
    /^plisio/i.test(methodRaw) ||
    /plisio/i.test(order.payment_protocol ?? "");

  const isCrypto =
    isPlisio ||
    meta?.m === "crypto" ||
    /^crypto/i.test(methodRaw) ||
    Boolean(order.payment_tx_id) ||
    Boolean(order.payment_protocol);

  const protocolCode = meta?.c || null;
  const protocolName = order.payment_protocol || meta?.p || protocolCode || null;
  const network = order.payment_network || meta?.n || null;
  const depositAddress = order.payment_address || meta?.a || null;
  const transactionId = order.payment_tx_id || meta?.tx || null;
  const plisioTxnId = meta?.ptx || null;
  const plisioCid = meta?.cid || null;
  const cryptoAmount = meta?.amt || null;
  const isTestMode = Boolean(
    isPlisio &&
      ((plisioTxnId && /^plisio_test_/i.test(plisioTxnId)) ||
        (transactionId && /^TEST_SIMULATED_/i.test(transactionId))),
  );

  if (!isCrypto) {
    return {
      isCrypto: false,
      isPlisio: false,
      isStripe: false,
      isTestMode: false,
      methodLabel: "Cash on Delivery (COD)",
      shortMethodLabel: "COD",
      protocolCode: null,
      protocolName: null,
      network: null,
      depositAddress: null,
      transactionId: null,
      plisioTxnId: null,
      plisioCid: null,
      cryptoAmount: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      customerNotes: rawNotes || null,
    };
  }

  const netShort = network ? shortNetworkTag(network) : null;
  const codeOrName = protocolCode || protocolName || "CRYPTO";
  const prefix = isPlisio ? "PLISIO" : "CRYPTO";
  const baseShortLabel = netShort
    ? `${prefix} · ${codeOrName} (${netShort})`
    : `${prefix} · ${codeOrName}`;
  const shortMethodLabel = isTestMode
    ? `${baseShortLabel} [TEST]`
    : baseShortLabel;

  const fullProto =
    protocolName && network
      ? `${protocolName} (${network})`
      : protocolName || protocolCode || "Cryptocurrency";

  return {
    isCrypto: true,
    isPlisio,
    isStripe: false,
    isTestMode,
    methodLabel: isPlisio
      ? `${isTestMode ? "Plisio Crypto [TEST MODE]" : "Plisio Crypto"} — ${fullProto}`
      : `Cryptocurrency — ${fullProto}`,
    shortMethodLabel,
    protocolCode,
    protocolName,
    network,
    depositAddress,
    transactionId,
    plisioTxnId,
    plisioCid,
    cryptoAmount,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    customerNotes: rawNotes || null,
  };
}
