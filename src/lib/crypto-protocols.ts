export type CryptoProtocol = {
  id: string;
  code: string;
  name: string;
  network: string;
  address: string;
  badge: string | null;
  enabled: boolean;
};

export const DEFAULT_CRYPTO_PROTOCOLS: CryptoProtocol[] = [
  {
    id: "btc-native",
    code: "BTC",
    name: "Bitcoin",
    network: "Bitcoin Network",
    address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    badge: null,
    enabled: true,
  },
  {
    id: "eth-erc20",
    code: "ETH",
    name: "Ethereum",
    network: "ERC20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "sol-mainnet",
    code: "SOL",
    name: "Solana",
    network: "Solana Mainnet",
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    badge: null,
    enabled: true,
  },
  {
    id: "bnb-bep20",
    code: "BNB",
    name: "Binance Coin",
    network: "BEP20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "usdt-trc20",
    code: "USDT",
    name: "Tether USDT",
    network: "TRON TRC20",
    address: "TFshfiXsqxNxeTaNMojzVjynTfdAgxatVG",
    badge: "Recommended • $1 Fee",
    enabled: true,
  },
  {
    id: "usdt-erc20",
    code: "USDT",
    name: "Tether USDT",
    network: "ERC20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "usdt-bep20",
    code: "USDT",
    name: "Tether USDT",
    network: "BEP20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "usdc-erc20",
    code: "USDC",
    name: "USD Coin",
    network: "ERC20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "busd-bep20",
    code: "BUSD",
    name: "Binance USD",
    network: "BEP20 Network",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    badge: null,
    enabled: true,
  },
  {
    id: "ltc-native",
    code: "LTC",
    name: "Litecoin",
    network: "Litecoin Network",
    address: "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    badge: null,
    enabled: true,
  },
  {
    id: "trx-trc20",
    code: "TRX",
    name: "TRON",
    network: "TRON TRC20",
    address: "TFshfiXsqxNxeTaNMojzVjynTfdAgxatVG",
    badge: null,
    enabled: true,
  },
  {
    id: "doge-native",
    code: "DOGE",
    name: "Dogecoin",
    network: "Dogecoin Network",
    address: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
    badge: null,
    enabled: true,
  },
];

export function normaliseCryptoProtocols(raw: unknown): CryptoProtocol[] {
  if (!Array.isArray(raw)) return DEFAULT_CRYPTO_PROTOCOLS;
  const out: CryptoProtocol[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : crypto.randomUUID();
    const code = typeof obj.code === "string" ? obj.code.trim().toUpperCase().slice(0, 16) : "";
    const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 60) : "";
    const network = typeof obj.network === "string" ? obj.network.trim().slice(0, 60) : "";
    const address = typeof obj.address === "string" ? obj.address.trim().slice(0, 160) : "";
    const badge =
      typeof obj.badge === "string" && obj.badge.trim()
        ? obj.badge.trim().slice(0, 60)
        : null;
    const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;

    if (!code || !name || !network || !address) continue;
    out.push({ id, code, name, network, address, badge, enabled });
  }
  return out;
}

/** Short network tag like "TRC20", "ERC20", "BEP20" when multiple protocols share a coin code. */
export function shortNetworkTag(network: string): string {
  const upper = network.toUpperCase();
  if (upper.includes("TRC20")) return "TRC20";
  if (upper.includes("ERC20")) return "ERC20";
  if (upper.includes("BEP20")) return "BEP20";
  if (upper.includes("SOL")) return "SOL";
  if (upper.includes("POLYGON") || upper.includes("MATIC")) return "POLYGON";
  if (upper.includes("ARBITRUM")) return "ARB";
  if (upper.includes("OPTIMISM")) return "OP";
  return network.replace(/\s*network\s*/i, "").trim();
}
