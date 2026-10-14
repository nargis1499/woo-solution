import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getMyOrders } from "@/lib/data/orders";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "My orders" };

export default function OrdersPage() {
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">My orders</h1>
      <Suspense fallback={<div className="card h-48 animate-pulse" aria-busy />}>
        <OrdersList />
      </Suspense>
    </div>
  );
}

async function OrdersList() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Forders");

  const orders = await getMyOrders();

  if (orders.length === 0) {
    return (
      <div className="card grid place-items-center gap-4 px-6 py-20 text-center">
        <p className="text-lg font-medium">No orders yet.</p>
        <p className="text-sm text-neutral-500">When you place an order it will show up here.</p>
        <ButtonLink href="/shop">Start shopping</ButtonLink>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-5 py-3 font-medium">Order</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Total</th>
            <th className="px-5 py-3 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {orders.map((order) => {
            const itemCount = (order.order_items ?? []).reduce((n, i) => n + i.quantity, 0);
            return (
              <tr key={order.id} className="hover:bg-neutral-50">
                <td className="px-5 py-4 font-medium">
                  <Link href={`/orders/${order.id}`} className="text-brand-700 dark:text-brand-300 hover:underline">
                    {formatOrderNumber(order.order_number)}
                  </Link>
                </td>
                <td className="px-5 py-4 text-neutral-600">{formatDate(order.created_at)}</td>
                <td className="px-5 py-4"><OrderStatusBadge status={order.status} /></td>
                <td className="px-5 py-4">
                  <span className="font-medium">{formatPrice(order.total_cents, order.currency)}</span>
                  <span className="text-neutral-500"> for {itemCount} {itemCount === 1 ? "item" : "items"}</span>
                </td>
                <td className="px-5 py-4 text-right">
                  <Link href={`/orders/${order.id}`} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100">
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
