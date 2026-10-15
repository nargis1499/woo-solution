"use client";

import { formatMoney, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";

/**
 * A base (USD-cent) amount in the store currency, with the optional struck-through
 * compare-at price. Pass `money` to format with a specific currency/rate (orders keep the
 * one they were placed with); otherwise the store setting applies.
 */
export function Price({
  cents,
  compareAtCents,
  money,
  className,
}: {
  cents: number;
  compareAtCents?: number | null;
  money?: Money;
  className?: string;
}) {
  const current = useMoney();
  const m = money ?? current;
  const onSale = compareAtCents != null && compareAtCents > cents;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-semibold tabular-nums", onSale && "text-primary")}>{formatMoney(cents, m)}</span>
      {onSale && <span className="text-sm text-muted-foreground line-through">{formatMoney(compareAtCents, m)}</span>}
    </span>
  );
}
