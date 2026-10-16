"use client";

import { formatMoney, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";

/**
 * A base (USD-micro) amount in the store currency, with the optional struck-through
 * compare-at price. Pass `money` to format with a specific currency/rate (orders keep the
 * one they were placed with); otherwise the store setting applies.
 */
export function Price({
  micros,
  compareAtMicros,
  money,
  className,
}: {
  micros: number;
  compareAtMicros?: number | null;
  money?: Money;
  className?: string;
}) {
  const current = useMoney();
  const m = money ?? current;
  const onSale = compareAtMicros != null && compareAtMicros > micros;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-semibold tabular-nums", onSale && "text-primary")}>{formatMoney(micros, m)}</span>
      {onSale && <span className="text-sm text-muted-foreground line-through">{formatMoney(compareAtMicros, m)}</span>}
    </span>
  );
}
