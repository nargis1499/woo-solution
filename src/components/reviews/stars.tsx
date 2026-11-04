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
    // `w-max` + non-shrinking icons are load-bearing: the filled row sits
    // inside a %-width clip. Without them the flex row takes the clip's
    // width and the SVGs shrink to fit it, so 4/5 stars rendered as five
    // tiny gold stars squeezed next to full-size grey ones.
    <span className="flex w-max shrink-0 gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          className={cn("shrink-0", starClassName, filled ? "fill-amber-400 text-amber-400" : "fill-current text-current opacity-25")}
        />
      ))}
    </span>
  );
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", className)} role="img" aria-label={`Rated ${formatRating(clamped)} out of 5 stars`}>
      <span className="relative inline-flex shrink-0">
        {row(false)}
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
          {row(true)}
        </span>
      </span>
      {showValue ? <span className="text-sm font-semibold tabular-nums">{formatRating(clamped)}</span> : null}
    </span>
  );
}
