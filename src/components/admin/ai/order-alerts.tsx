import {
  ArrowRightIcon,
  ClipboardListIcon,
  CreditCardIcon,
  InfoIcon,
  RotateCcwIcon,
  TruckIcon,
  UsersIcon,
} from "lucide-react";
import { orderAlertCopy } from "@/lib/ai/orders/alert-copy";
import type { OrderRow } from "@/lib/ai/orders/types";
import { cn } from "@/lib/utils";

const ICONS = {
  shipping: TruckIcon,
  payment: CreditCardIcon,
  details: InfoIcon,
  order: ClipboardListIcon,
  refund: RotateCcwIcon,
  customer: UsersIcon,
};

/** Static review hints, not error banners or one-click mutations. */
export function OrderAlerts({ order }: { order: OrderRow }) {
  if (order.flags.length === 0) return null;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium">Things to check</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
          {order.flags.length}
        </span>
      </div>
      <ul className="space-y-2" aria-label={`Checks for order #${order.order_number}`}>
        {order.flags.map((flag) => {
          const copy = orderAlertCopy(flag, order);
          const Icon = ICONS[copy.category];
          const high = flag.severity === "high";
          return (
            <li
              key={flag.reason}
              className={cn(
                "flex min-w-0 gap-2.5 rounded-lg border border-l-2 bg-background/60 p-3",
                high ? "border-l-amber-500" : "border-l-sky-500/70",
              )}
            >
              <span className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                high
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-sky-500/10 text-sky-700 dark:text-sky-400",
              )}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="break-words text-xs font-semibold leading-relaxed text-foreground">
                    {copy.title}
                  </p>
                  <span
                    aria-label={high ? "High priority: review soon" : "Medium priority: review"}
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      high
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                        : "bg-sky-500/10 text-sky-800 dark:text-sky-300",
                    )}
                  >
                    {high ? "Review soon" : "Review"}
                  </span>
                </div>
                {copy.explanation && (
                  <p className="break-words text-[11px] leading-relaxed text-muted-foreground">
                    {copy.explanation}
                  </p>
                )}
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground/85">
                  <ArrowRightIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 break-words"><span className="font-medium">Next step: </span>{copy.nextStep}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
