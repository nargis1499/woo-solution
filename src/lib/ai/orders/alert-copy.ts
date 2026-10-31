import type { OrderFlag, OrderRow } from "./types";

export type OrderAlertCopy = {
  title: string;
  explanation: string;
  nextStep: string;
  category: "shipping" | "payment" | "details" | "order" | "refund" | "customer";
};

// Presentation only: keep database reasons, priorities and detection rules unchanged.
// Exact legacy reasons also support stores that already applied the original migration.
const COPY: Record<string, OrderAlertCopy> = {
  "Paid but not shipped": {
    title: "Paid — shipment not recorded",
    explanation: "Payment is recorded, but this order isn’t marked as shipped.",
    nextStep: "Check if it was sent, then update the shipping details.",
    category: "shipping",
  },
  "Processing without a recent update": {
    title: "No recent order update",
    explanation: "This order has stayed in processing without a recent update.",
    nextStep: "Check what’s holding it up: stock, payment or shipping.",
    category: "order",
  },
  "Expected fulfillment time exceeded": {
    title: "Shipping update overdue",
    explanation: "The shipping deadline has passed, but shipment isn’t recorded.",
    nextStep: "Check if it was sent, then update the shipping details.",
    category: "shipping",
  },
  "Shipment delayed or delivery estimate exceeded": {
    title: "Delivery may be late",
    explanation: "Shipping is marked delayed, or the expected delivery date has passed.",
    nextStep: "Check the carrier’s tracking and let the customer know.",
    category: "shipping",
  },
  "Unpaid beyond the review threshold (may be COD)": {
    title: "Payment needs checking",
    explanation: "Payment is still marked unpaid after the review time. This doesn’t mean it failed.",
    nextStep: "Check the payment method and whether payment was received.",
    category: "payment",
  },
  "Customer has at least three historical cancellations": {
    title: "Several past cancellations",
    explanation: "This customer has cancelled at least three orders. This alone doesn’t mean fraud.",
    nextStep: "Review their order history before sending this order.",
    category: "customer",
  },
  "Order value exceeds the configured review threshold": {
    title: "Large order amount",
    explanation: "The total is above your order-value review limit.",
    nextStep: "Verify the payment before sending the order.",
    category: "payment",
  },
  "Quantity exceeds the configured review threshold": {
    title: "Large number of items",
    explanation: "The item count is above your quantity review limit.",
    nextStep: "Confirm the quantity with the customer and check stock.",
    category: "order",
  },
  "Refund request awaiting resolution for over 48 hours": {
    title: "Refund request still waiting",
    explanation: "This refund request has been open for more than two days.",
    nextStep: "Review it with your payment provider. No money has been refunded by this assistant.",
    category: "refund",
  },
};

export function orderAlertCopy(flag: OrderFlag, order: Pick<OrderRow, "fulfillment_status" | "payment_method">): OrderAlertCopy {
  if (flag.reason === "Fulfillment or tracking information is incomplete") {
    return order.fulfillment_status === "shipped"
      ? {
          title: "Tracking number missing",
          explanation: "This order is marked as shipped, but no tracking number is saved.",
          nextStep: "Add the tracking number from the carrier.",
          category: "details",
        }
      : {
          title: "Shipping status missing",
          explanation: "The shipping progress hasn’t been recorded. Older orders may need a one-time update.",
          nextStep: "Check whether it was sent or delivered, then update the order.",
          category: "details",
        };
  }
  if (flag.reason === "Unpaid beyond the review threshold (may be COD)" && order.payment_method === "cod") {
    return {
      title: "Cash-on-delivery payment to check",
      explanation: "This order is still marked unpaid. Cash on delivery may stay unpaid until delivery.",
      nextStep: "Check if the cash was collected before changing the payment status.",
      category: "payment",
    };
  }
  return Object.hasOwn(COPY, flag.reason)
    ? COPY[flag.reason]
    : { title: flag.reason, explanation: "", nextStep: flag.next, category: "order" };
}
