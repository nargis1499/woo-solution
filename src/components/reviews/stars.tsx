import { StarIcon } from "lucide-react";
import { formatRating } from "@/lib/reviews";
import { cn } from "@/lib/utils";

/**
 * Read-only star display with fractional fill (4.3 ★ paints 86% of the row).
 * Used on cards, the product header, the reviews summary and the admin queue.
 */
export function Stars({
  value,
  className,
  starClassName = "size-4",
  showValue = false,
}: {
  value: number;
  className?: string;
  starClassName?: string;
  showValue?: boolean;
}) {
  const clamped = Math.min(5, Math.max(0, value || 0));
  const pct = (clamped / 5) * 100;
  const row = (filled: boolean) => (
    <div className="flex gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          className={cn(starClassName, filled ? "fill-amber-400 text-amber-400" : "fill-current text-current opacity-25")}
        />
      ))}
    </div>
  );
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} role="img" aria-label={`Rated ${formatRating(clamped)} out of 5 stars`}>
      <span className="relative inline-block">
        {row(false)}
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
          {row(true)}
        </span>
      </span>
      {showValue ? <span className="text-sm font-semibold tabular-nums">{formatRating(clamped)}</span> : null}
    </span>
  );
}
