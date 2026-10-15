// Money formatting lives in src/lib/money.ts (formatMoney / formatCents) – it depends on
// the store currency chosen in Settings → WooCommerce.

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatOrderNumber(n: number): string {
  return `#${n.toString().padStart(4, "0")}`;
}
