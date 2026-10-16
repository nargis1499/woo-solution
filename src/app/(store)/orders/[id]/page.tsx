import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CircleCheckIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getMyOrder } from "@/lib/data/orders";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ProductImage } from "@/components/product-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Order details", robots: NOINDEX };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ placed?: string }>;

export default function OrderPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="container-page py-10">
      <Suspense fallback={<Skeleton className="mx-auto h-64 w-full max-w-3xl rounded-xl" aria-busy />}>
        <OrderDetails params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OrderDetails({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, { placed }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/orders/${id}`)}`);
  const order = await getMyOrder(id);
  if (!order) notFound();
  const items = order.order_items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {placed && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CircleCheckIcon />
          <AlertTitle>Thank you. Your order has been received!</AlertTitle>
          <AlertDescription className="text-current/80">
            We&apos;ve sent a confirmation to {order.customer_email ?? "your e-mail"}. Pay in cash when it arrives.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageBreadcrumbs className="mb-2" items={[{ label: "My orders", href: "/orders" }, { label: formatOrderNumber(order.order_number) }]} />
          <h1 className="text-3xl font-bold tracking-tight">Order {formatOrderNumber(order.order_number)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Placed on {formatDate(order.created_at)}</p>
        </div>
        <OrderStatusBadge status={order.status} className="text-sm" />
      </div>

      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 p-4 sm:p-5">
              <div className="w-16 shrink-0 overflow-hidden rounded-lg">
                <ProductImage src={item.image_url} alt={item.product_name} sizes="64px" />
              </div>
              <div className="min-w-0 flex-1">
                {item.product_slug ? (
                  <Link href={`/products/${item.product_slug}`} className="font-medium hover:text-primary">
                    {item.product_name}
                  </Link>
                ) : (
                  <p className="font-medium">{item.product_name}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {formatMoney(item.unit_price_micros, orderMoney(order))} × {item.quantity}
                </p>
              </div>
              <p className="font-semibold tabular-nums">{formatMoney(item.line_total_micros, orderMoney(order))}</p>
            </li>
          ))}
        </ul>
        <Separator />
        <CardFooter className="bg-muted/40 py-5">
          <dl className="w-full space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(order.subtotal_micros, orderMoney(order))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="tabular-nums">{order.shipping_micros === 0 ? "Free" : formatMoney(order.shipping_micros, orderMoney(order))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Payment</dt>
              <dd>
                {order.payment_method === "cod" ? "Cash on delivery" : order.payment_method} ·{" "}
                {order.payment_status === "paid" ? "Paid" : order.payment_status === "refunded" ? "Refunded" : "Unpaid"}
              </dd>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(order.total_micros, orderMoney(order))}</dd>
            </div>
          </dl>
        </CardFooter>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Shipping address</CardTitle>
          </CardHeader>
          <CardContent>
            <address className="text-sm leading-relaxed text-muted-foreground not-italic">
              {order.shipping_name}
              <br />
              {order.shipping_address_line1}
              <br />
              {order.shipping_address_line2 && (
                <>
                  {order.shipping_address_line2}
                  <br />
                </>
              )}
              {order.shipping_city}
              {order.shipping_postal_code ? `, ${order.shipping_postal_code}` : ""}
              <br />
              {order.shipping_country}
              {order.shipping_phone && (
                <>
                  <br />
                  {order.shipping_phone}
                </>
              )}
            </address>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Order notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{order.notes || "—"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Link href="/shop" className={buttonVariants({ variant: "outline" })}>
          Continue shopping
        </Link>
        <Link href="/orders" className={buttonVariants({ variant: "ghost" })}>
          All orders
        </Link>
      </div>
    </div>
  );
}
