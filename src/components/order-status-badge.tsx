import type { OrderStatus, PaymentStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Colour per status; works in both themes. */
export const STATUS_TONES: Record<OrderStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  processing: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge variant={status === "cancelled" ? "secondary" : "outline"} className={cn("capitalize", STATUS_TONES[status] ?? STATUS_TONES.pending, className)}>
      {status}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge
      variant={status === "refunded" ? "secondary" : "outline"}
      className={cn("capitalize", status === "paid" ? STATUS_TONES.completed : status === "unpaid" ? STATUS_TONES.pending : "")}
    >
      {status}
    </Badge>
  );
}
