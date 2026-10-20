import { shortNetworkTag } from "./crypto-protocols";
import type { Order } from "./types";

export type OrderPaymentInput = {
  method: "cod" | "crypto" | "plisio";
  gateway?: "plisio" | "manual";
  protocolCode?: string;
  protocolName?: string;
  network?: string;
  depositAddress?: string;
  transactionId?: string;
  plisioTxnId?: string;
  plisioCid?: string;
  cryptoAmount?: string;
};

export type ParsedOrderPayment = {
  isCrypto: boolean;
  isPlisio: boolean;
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
  customerNotes: string | null;
};

const PAYMENT_META_PREFIX = "[PAYMENT_META:";
const PAYMENT_META_SUFFIX = "]";

type EncodedPaymentMeta = {
  m?: "crypto" | "cod" | "plisio";
  g?: "plisio" | "manual";
  c?: string;
  p?: string;
  n?: string;
  a?: string;
  tx?: string;
  ptx?: string;
  cid?: string;
  amt?: string;
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

  const meta: EncodedPaymentMeta = {
    m: isPlisio ? "plisio" : "crypto",
    g: isPlisio ? "plisio" : undefined,
    c: payment.protocolCode?.trim() || undefined,
    p: payment.protocolName?.trim() || undefined,
    n: payment.network?.trim() || undefined,
    a: payment.depositAddress?.trim() || undefined,
    tx: payment.transactionId?.trim() || undefined,
    ptx: payment.plisioTxnId?.trim() || undefined,
    cid: payment.plisioCid?.trim() || undefined,
    amt: payment.cryptoAmount?.trim() || undefined,
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

  if (!isCrypto) {
    return {
      isCrypto: false,
      isPlisio: false,
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
      customerNotes: rawNotes || null,
    };
  }

  const netShort = network ? shortNetworkTag(network) : null;
  const codeOrName = protocolCode || protocolName || "CRYPTO";
  const prefix = isPlisio ? "PLISIO" : "CRYPTO";
  const shortMethodLabel = netShort
    ? `${prefix} · ${codeOrName} (${netShort})`
    : `${prefix} · ${codeOrName}`;

  const fullProto =
    protocolName && network
      ? `${protocolName} (${network})`
      : protocolName || protocolCode || "Cryptocurrency";

  return {
    isCrypto: true,
    isPlisio,
    methodLabel: isPlisio
      ? `Plisio Crypto — ${fullProto}`
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
    customerNotes: rawNotes || null,
  };
}
