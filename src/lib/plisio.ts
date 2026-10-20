export type PlisioCurrency = {
  /** Plisio currency identifier (`cid`), e.g. "USDT_TRX", "BTC", "ETH" */
  cid: string;
  /** Short coin ticker, e.g. "USDT", "BTC", "ETH" */
  code: string;
  /** Full coin name, e.g. "Tether USD", "Bitcoin" */
  name: string;
  /** Blockchain network label, e.g. "TRON (TRC20)" */
  network: string;
  /** Short network tag, e.g. "TRC20", "ERC20", "BEP20", "Mainnet" */
  networkTag: string;
  /** Optional UX badge shown to the customer */
  badge?: string;
  /** Estimated confirmation time shown in the UI */
  eta: string;
  /** Approximate USD exchange rate fallback when live quote is pending */
  approxUsdRate: number;
  /** Decimal precision for displaying crypto amounts */
  decimals: number;
};

export const PLISIO_CURRENCIES: PlisioCurrency[] = [
  {
    cid: "USDT_TRX",
    code: "USDT",
    name: "Tether USD",
    network: "TRON (TRC20)",
    networkTag: "TRC20",
    badge: "Popular · Low Fee",
    eta: "~1 min",
    approxUsdRate: 1,
    decimals: 2,
  },
  {
    cid: "USDT_BSC",
    code: "USDT",
    name: "Tether USD",
    network: "BNB Smart Chain (BEP20)",
    networkTag: "BEP20",
    badge: "Fast · Low Fee",
    eta: "~1 min",
    approxUsdRate: 1,
    decimals: 2,
  },
  {
    cid: "USDT",
    code: "USDT",
    name: "Tether USD",
    network: "Ethereum (ERC20)",
    networkTag: "ERC20",
    eta: "~2 min",
    approxUsdRate: 1,
    decimals: 2,
  },
  {
    cid: "BTC",
    code: "BTC",
    name: "Bitcoin",
    network: "Bitcoin Mainnet",
    networkTag: "BTC",
    badge: "Most Secure",
    eta: "~10 min",
    approxUsdRate: 68000,
    decimals: 6,
  },
  {
    cid: "ETH",
    code: "ETH",
    name: "Ethereum",
    network: "Ethereum Mainnet",
    networkTag: "ERC20",
    eta: "~2 min",
    approxUsdRate: 2650,
    decimals: 5,
  },
  {
    cid: "SOL",
    code: "SOL",
    name: "Solana",
    network: "Solana Mainnet",
    networkTag: "SPL",
    badge: "Instant",
    eta: "~30 sec",
    approxUsdRate: 155,
    decimals: 4,
  },
  {
    cid: "LTC",
    code: "LTC",
    name: "Litecoin",
    network: "Litecoin Mainnet",
    networkTag: "LTC",
    badge: "Low Fee",
    eta: "~2 min",
    approxUsdRate: 72,
    decimals: 4,
  },
  {
    cid: "TRX",
    code: "TRX",
    name: "TRON",
    network: "TRON Mainnet",
    networkTag: "TRC20",
    eta: "~1 min",
    approxUsdRate: 0.16,
    decimals: 2,
  },
];

export type PlisioInvoiceSession = {
  orderId: string;
  orderNumber: number;
  txnId: string;
  cid: string;
  code: string;
  name: string;
  network: string;
  networkTag: string;
  walletAddress: string;
  cryptoAmount: string;
  usdAmount: string;
  invoiceUrl: string | null;
  expiresAtMs: number;
  status: "new" | "pending" | "completed" | "mismatch" | "expired" | "cancelled";
  txId: string | null;
  mode: "live" | "sandbox";
};

export function getPlisioCurrency(cid: string): PlisioCurrency {
  return (
    PLISIO_CURRENCIES.find((c) => c.cid.toUpperCase() === cid.toUpperCase()) ??
    PLISIO_CURRENCIES[0]
  );
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
