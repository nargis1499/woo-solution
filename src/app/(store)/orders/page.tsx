import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PackageIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getMyOrders } from "@/lib/data/orders";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DataGrid } from "@/components/data-grid";

export const metadata: Metadata = { title: "My orders", robots: NOINDEX };

export default function OrdersPage() {
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">My orders</h1>
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" aria-busy />}>
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
      <Empty className="border border-dashed py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon />
          </EmptyMedia>
          <EmptyTitle>No orders yet</EmptyTitle>
          <EmptyDescription>When you place an order it will show up here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/shop" className={buttonVariants()}>
            Start shopping
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Card className="py-0">
      <DataGrid
        label="My orders"
        columns={[
          { id: "order", label: "Order", className: "pl-5" },
          { id: "date", label: "Date" },
          { id: "status", label: "Status" },
          { id: "total", label: "Total" },
          { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-5" },
        ]}
        rows={orders.map((order) => {
          const itemCount = (order.order_items ?? []).reduce((n, i) => n + i.quantity, 0);
          return {
            id: order.id,
            cells: [
              <Link key="n" href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                {formatOrderNumber(order.order_number)}
              </Link>,
              <span key="d" className="text-muted-foreground">
                {formatDate(order.created_at)}
              </span>,
              <OrderStatusBadge key="s" status={order.status} />,
              <span key="t">
                <span className="font-medium tabular-nums">{formatMoney(order.total_micros, orderMoney(order))}</span>
                <span className="text-muted-foreground">
                  {" "}
                  for {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
              </span>,
              <Link key="a" href={`/orders/${order.id}`} className={buttonVariants({ variant: "outline", size: "xs" })}>
                View
              </Link>,
            ],
          };
        })}
      />
    </Card>
  );
}
