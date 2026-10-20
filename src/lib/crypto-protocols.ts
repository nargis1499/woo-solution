export type CryptoProtocol = {
  id: string;
  code: string;
  name: string;
  network: string;
  address: string;
  badge: string | null;
  enabled: boolean;
};

export const DEFAULT_CRYPTO_PROTOCOLS: CryptoProtocol[] = [];

export function normaliseCryptoProtocols(raw: unknown): CryptoProtocol[] {
  if (!Array.isArray(raw)) return [];
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
