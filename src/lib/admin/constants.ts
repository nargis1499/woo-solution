import type { OrderStatus, PaymentStatus } from "@/lib/types";

export const ORDER_STATUSES: OrderStatus[] = ["pending", "processing", "completed", "cancelled"];
export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "paid", "refunded"];
