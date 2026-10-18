"use client";

import { formatMoney, type Money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";

/**
 * What a customer pays (base USD micros) in the store currency, with the optional regular
 * price struck through next to it while the product is on sale. Pass `money` to format with a
 * specific currency/rate (orders keep the one they were placed with); otherwise the store
 * setting applies.
 */
export function Price({
  micros,
  regularMicros,
  money,
  className,
  from = false,
}: {
  micros: number;
  /** The regular price – drawn struck-through when it is higher than `micros`. */
  regularMicros?: number | null;
  money?: Money;
  className?: string;
  /** Variable products: the amount is the cheapest enabled variation ("From ৳…"). */
  from?: boolean;
}) {
  const current = useMoney();
  const m = money ?? current;
  const onSale = regularMicros != null && regularMicros > micros;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="font-extrabold text-foreground tabular-nums">
        {from && <span className="mr-1 text-sm font-normal text-muted-foreground">From</span>}
        {formatMoney(micros, m)}
      </span>
      {onSale && (
        <span className="text-xs font-normal text-muted-foreground line-through tabular-nums">
          {formatMoney(regularMicros as number, m)}
        </span>
      )}
    </span>
  );
}
