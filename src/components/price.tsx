import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Price({
  cents,
  compareAtCents,
  currency,
  className,
}: {
  cents: number;
  compareAtCents?: number | null;
  currency?: string;
  className?: string;
}) {
  const onSale = compareAtCents != null && compareAtCents > cents;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-semibold tabular-nums", onSale && "text-primary")}>{formatPrice(cents, currency)}</span>
      {onSale && <span className="text-sm text-muted-foreground line-through">{formatPrice(compareAtCents, currency)}</span>}
    </span>
  );
}
