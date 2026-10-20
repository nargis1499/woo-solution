export type PlisioCurrency = {
  /** Plisio currency identifier (`cid`), e.g. "USDT_TRX", "BTC", "ETH", "SOL", "TON" */
  cid: string;
  /** Short coin ticker, e.g. "USDT", "BTC", "ETH" */
  code: string;
  /** Full coin name, e.g. "Tether USD", "Bitcoin" */
  name: string;
  /** Blockchain network label, e.g. "TRON (TRC20)" */
  network: string;
  /** Short network tag, e.g. "TRC20", "ERC20", "BEP20", "BTC" */
  networkTag: string;
  /** Optional UX badge shown to the customer */
  badge?: string | null;
  /** Estimated confirmation time shown in the UI */
  eta: string;
  /** USD price per 1 unit of coin (from Plisio API or Admin configuration) */
  approxUsdRate: number;
  /** Decimal precision for displaying crypto amounts */
  decimals: number;
  /** Whether this coin is enabled by the Admin to show on the storefront checkout */
  enabled: boolean;
};

export type PlisioInvoiceSession = {
  orderId: string;
  orderNumber?: number;
  txnId: string;
  cid: string;
  code: string;
  name: string;
  network: string;
  networkTag: string;
  walletAddress: string;
  cryptoAmount: string;
  usdAmount?: string;
  fiatAmountUsd?: string;
  invoiceUrl: string | null;
  expiresAtMs: number;
  status: "new" | "pending" | "completed" | "mismatch" | "expired" | "cancelled";
  txId?: string | null;
  mode: "live" | "sandbox";
};

/**
 * Infers clean display metadata (`code`, `name`, `network`, `networkTag`, `eta`, `decimals`)
 * from any Plisio `cid` and raw currency name returned by Plisio's API.
 */
export function inferPlisioNetworkInfo(
  rawCid: string,
  rawName?: string,
  rawCurrency?: string,
): {
  cid: string;
  code: string;
  name: string;
  network: string;
  networkTag: string;
  eta: string;
  decimals: number;
} {
  const cid = rawCid.trim().toUpperCase();
  const baseCode = (rawCurrency?.trim() || cid.split("_")[0] || cid).toUpperCase();
  const cleanName = (rawName?.trim() || baseCode).replace(/\s*\([^)]*\)\s*$/, "").trim() || baseCode;

  if (cid.endsWith("_TRX") || cid === "TRX" || /trc-?20|tron/i.test(rawName ?? "")) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: cid === "TRX" ? "TRON Mainnet" : "TRON (TRC20)",
      networkTag: "TRC20",
      eta: "~1 min",
      decimals: baseCode.includes("USD") ? 2 : 2,
    };
  }
  if (cid.endsWith("_BSC") || cid === "BNB" || /bep-?20|bsc|bnb/i.test(rawName ?? "")) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: "BNB Smart Chain (BEP20)",
      networkTag: "BEP20",
      eta: "~1 min",
      decimals: baseCode.includes("USD") ? 2 : 4,
    };
  }
  if (cid.endsWith("_SOL") || cid === "SOL" || /solana|spl/i.test(rawName ?? "")) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: cid === "SOL" ? "Solana Mainnet" : "Solana (SPL)",
      networkTag: "SPL",
      eta: "~30 sec",
      decimals: baseCode.includes("USD") ? 2 : 4,
    };
  }
  if (cid.endsWith("_TON") || cid === "TON" || /\bton\b/i.test(rawName ?? "")) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: "TON Network",
      networkTag: "TON",
      eta: "~30 sec",
      decimals: baseCode.includes("USD") ? 2 : 3,
    };
  }
  if (
    cid.endsWith("_MATIC") ||
    cid.endsWith("_POL") ||
    cid === "MATIC" ||
    cid === "POL" ||
    /polygon/i.test(rawName ?? "")
  ) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: "Polygon Network",
      networkTag: "POLYGON",
      eta: "~1 min",
      decimals: baseCode.includes("USD") ? 2 : 3,
    };
  }
  if (
    cid === "ETH" ||
    cid === "USDT" ||
    cid === "USDC" ||
    cid === "SHIB" ||
    cid.endsWith("_ETH") ||
    /erc-?20|ethereum/i.test(rawName ?? "")
  ) {
    return {
      cid,
      code: baseCode,
      name: cleanName,
      network: cid === "ETH" ? "Ethereum Mainnet" : "Ethereum (ERC20)",
      networkTag: "ERC20",
      eta: "~2 min",
      decimals: baseCode.includes("USD") ? 2 : 5,
    };
  }
  if (cid === "BTC") {
    return {
      cid,
      code: "BTC",
      name: cleanName || "Bitcoin",
      network: "Bitcoin Mainnet",
      networkTag: "BTC",
      eta: "~10 min",
      decimals: 6,
    };
  }
  if (cid === "LTC") {
    return {
      cid,
      code: "LTC",
      name: cleanName || "Litecoin",
      network: "Litecoin Mainnet",
      networkTag: "LTC",
      eta: "~2 min",
      decimals: 4,
    };
  }
  if (cid === "DOGE") {
    return {
      cid,
      code: "DOGE",
      name: cleanName || "Dogecoin",
      network: "Dogecoin Mainnet",
      networkTag: "DOGE",
      eta: "~2 min",
      decimals: 2,
    };
  }
  if (cid === "XMR") {
    return {
      cid,
      code: "XMR",
      name: cleanName || "Monero",
      network: "Monero Mainnet",
      networkTag: "XMR",
      eta: "~2 min",
      decimals: 4,
    };
  }
  if (cid === "BCH") {
    return {
      cid,
      code: "BCH",
      name: cleanName || "Bitcoin Cash",
      network: "Bitcoin Cash Mainnet",
      networkTag: "BCH",
      eta: "~5 min",
      decimals: 5,
    };
  }

  const suffix = cid.includes("_") ? cid.split("_").slice(1).join("_") : baseCode;
  return {
    cid,
    code: baseCode,
    name: cleanName,
    network: suffix !== baseCode ? `${suffix} Network` : `${baseCode} Mainnet`,
    networkTag: suffix.slice(0, 8),
    eta: "~2 min",
    decimals: baseCode.includes("USD") ? 2 : 4,
  };
}

/**
 * Normalizes a JSON array of Plisio currencies stored in `site_settings.payment_plisio_currencies`.
 * Defaults to `[]` (no static coins).
 */
export function normalisePlisioCurrencies(raw: unknown): PlisioCurrency[] {
  if (!Array.isArray(raw)) return [];
  const out: PlisioCurrency[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawCid = typeof rec.cid === "string" ? rec.cid.trim().toUpperCase() : "";
    if (!rawCid || seen.has(rawCid)) continue;
    seen.add(rawCid);

    const inferred = inferPlisioNetworkInfo(
      rawCid,
      typeof rec.name === "string" ? rec.name : undefined,
      typeof rec.code === "string" ? rec.code : undefined,
    );

    const code =
      typeof rec.code === "string" && rec.code.trim()
        ? rec.code.trim().toUpperCase()
        : inferred.code;
    const name =
      typeof rec.name === "string" && rec.name.trim()
        ? rec.name.trim()
        : inferred.name;
    const network =
      typeof rec.network === "string" && rec.network.trim()
        ? rec.network.trim()
        : inferred.network;
    const networkTag =
      typeof rec.networkTag === "string" && rec.networkTag.trim()
        ? rec.networkTag.trim().toUpperCase()
        : inferred.networkTag;
    const badge =
      typeof rec.badge === "string" && rec.badge.trim() ? rec.badge.trim() : null;
    const eta =
      typeof rec.eta === "string" && rec.eta.trim() ? rec.eta.trim() : inferred.eta;
    const approxUsdRate =
      typeof rec.approxUsdRate === "number" &&
      Number.isFinite(rec.approxUsdRate) &&
      rec.approxUsdRate > 0
        ? rec.approxUsdRate
        : Number(rec.approxUsdRate) > 0
          ? Number(rec.approxUsdRate)
          : 1;
    const decimals =
      typeof rec.decimals === "number" &&
      Number.isFinite(rec.decimals) &&
      rec.decimals >= 0 &&
      rec.decimals <= 8
        ? Math.floor(rec.decimals)
        : inferred.decimals;
    const enabled = typeof rec.enabled === "boolean" ? rec.enabled : true;

    out.push({
      cid: rawCid,
      code,
      name,
      network,
      networkTag,
      badge,
      eta,
      approxUsdRate,
      decimals,
      enabled,
    });
  }

  return out;
}

/**
 * Resolves a PlisioCurrency from the dynamic list by `cid`, or constructs a fallback
 * descriptor from `cid` if not found.
 */
export function resolvePlisioCurrency(
  currencies: PlisioCurrency[],
  cid: string,
): PlisioCurrency {
  const cleanCid = (cid || "USDT_TRX").trim().toUpperCase();
  const found =
    currencies.find((c) => c.cid.toUpperCase() === cleanCid) ?? currencies[0];
  if (found) return found;

  const inferred = inferPlisioNetworkInfo(cleanCid);
  return {
    ...inferred,
    badge: null,
    approxUsdRate: 1,
    enabled: true,
  };
}

/** Formats a USD micro-dollar total into an estimated crypto amount string. */
export function estimatePlisioCryptoAmount(
  totalMicros: number,
  currency: PlisioCurrency,
): string {
  const usd = Math.max(0, totalMicros) / 1_000_000;
  const raw = usd / (currency.approxUsdRate || 1);
  return raw.toFixed(currency.decimals);
}
