import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangleIcon, CircleCheckIcon, Clock3Icon, CreditCardIcon, ExternalLinkIcon, TruckIcon } from "lucide-react";
import { resumeStripeCheckout } from "@/app/(store)/checkout/actions";
import { getCurrentUser } from "@/lib/auth";
import { getMyOrder } from "@/lib/data/orders";
import { listOrderMessagesOrNull } from "@/lib/order-messages";
import { parseOrderPaymentInfo } from "@/lib/order-payment";
import { resolveOrderTracking } from "@/lib/order-tracking";
import { getStorePresence } from "@/lib/presence.server";
import { syncStripeCheckoutSession } from "@/lib/stripe.server";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { OrderChat } from "@/components/order-chat/order-chat";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ProductImage } from "@/components/product-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Order details", robots: NOINDEX };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ placed?: string; stripe?: string; session_id?: string }>;

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
  const [{ id }, { placed, stripe: stripeReturn, session_id: stripeSessionId }, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/orders/${id}`)}`);

  // A Stripe success redirect is only a hint. Retrieve and verify the actual
  // Checkout Session server-side before this page reads the order; the signed
  // webhook runs the same idempotent reconciliation in the background.
  if (stripeReturn === "success" && stripeSessionId) {
    await syncStripeCheckoutSession(stripeSessionId, {
      expectedOrderId: id,
      expectedUserId: user.id,
    }).catch(() => null);
  }

  const order = await getMyOrder(id);
  if (!order) notFound();
  const items = order.order_items ?? [];
  const paymentInfo = parseOrderPaymentInfo(order);
  const tracking = resolveOrderTracking(order);
  const stripePaid = paymentInfo.isStripe && order.payment_status === "paid";
  const stripeUnpaid =
    paymentInfo.isStripe && order.payment_status === "unpaid" && order.status !== "cancelled";
  const stripeProcessing =
    stripeUnpaid && (stripeReturn === "processing" || stripeReturn === "success");
  // `null` = migration 17 not run yet → the thread is simply not shown.
  // The store's presence is resolved *for this customer*: their per-customer override (migration 20),
  // else the admin's global switch. The customer never gets an activity time the admin hid.
  const [messages, store] = await Promise.all([listOrderMessagesOrNull(order.id), getStorePresence(order.user_id)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {placed && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CircleCheckIcon />
          <AlertTitle>Thank you. Your order has been received!</AlertTitle>
          <AlertDescription className="text-current/80">
            {paymentInfo.isPlisio && order.payment_status === "paid"
              ? `Plisio verified your blockchain payment automatically! Your order is Paid and now Processing.`
              : stripePaid
                ? `Stripe confirmed your payment automatically! Your order is Paid and now Processing.`
                : paymentInfo.isStripe
                  ? `We've received your order and are waiting for Stripe to confirm the payment. You can safely close this page — it will update automatically.`
                  : paymentInfo.isCrypto
                    ? `We've received your Transaction ID (TXID) and sent a confirmation to ${order.customer_email ?? "your e-mail"}. The Admin will verify your payment shortly.`
                    : `We've sent a confirmation to ${order.customer_email ?? "your e-mail"}. Pay in cash when it arrives.`}
          </AlertDescription>
        </Alert>
      )}

      {stripeUnpaid && stripeReturn === "cancelled" && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangleIcon />
          <AlertTitle>Stripe payment wasn&apos;t completed</AlertTitle>
          <AlertDescription className="text-current/80">
            Your order is saved but still unpaid. Use “Pay with Stripe” below whenever you&apos;re ready — you
            don&apos;t need to place the order again.
          </AlertDescription>
        </Alert>
      )}

      {stripeUnpaid && stripeReturn === "session-error" && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>We couldn&apos;t open Stripe Checkout</AlertTitle>
          <AlertDescription>
            Your order is saved but still unpaid. Please try “Pay with Stripe” below again in a moment.
          </AlertDescription>
        </Alert>
      )}

      {stripeProcessing && (
        <Alert className="border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <Clock3Icon />
          <AlertTitle>Stripe is confirming your payment</AlertTitle>
          <AlertDescription className="text-current/80">
            Some payment methods take a little longer to settle. This order will move to Paid &amp; Processing
            automatically as soon as Stripe confirms it.
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

      {stripeUnpaid && (
        <Card className="border-violet-500/30 bg-violet-500/[0.05]" data-testid="order-stripe-pay-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-400">
                <CreditCardIcon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">Complete your Stripe payment</p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(order.total_micros, orderMoney(order))} is due. Stripe will open its secure hosted
                  checkout; this order updates automatically after confirmation.
                </p>
              </div>
            </div>
            <form action={resumeStripeCheckout.bind(null, order.id)}>
              <Button type="submit" data-testid="order-pay-with-stripe">
                Pay with Stripe
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tracking.hasTracking && (
        <Card className="border-primary/25 bg-primary/[0.02]" data-testid="order-tracking-card">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2.5 text-base">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                  <TruckIcon className="size-4" aria-hidden />
                </span>
                <span>Shipment &amp; tracking</span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={tracking.fulfillmentStatus === "delivered" ? "default" : "secondary"}>
                  {tracking.fulfillmentLabel}
                </Badge>
                {tracking.trackingUrl && (
                  <a
                    href={tracking.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: "xs", variant: "outline" })}
                    data-testid="order-track-package-link"
                  >
                    Track package
                    <ExternalLinkIcon className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="Fulfillment progress">
              {(["Order placed", "Packed", "Shipped", "Delivered"] as const).map((label, idx) => {
                const done = idx <= tracking.stepIndex;
                return (
                  <li key={label} className="space-y-1.5">
                    <div
                      className={cn(
                        "h-1.5 rounded-full transition-colors",
                        done ? "bg-primary" : "bg-muted",
                      )}
                    />
                    <p className={cn("font-medium", done ? "text-foreground" : "text-muted-foreground")}>
                      {label}
                    </p>
                  </li>
                );
              })}
            </ol>

            {(tracking.carrier || tracking.trackingNumber || tracking.shippedAt || tracking.deliveredAt) && (
              <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-3">
                {tracking.carrier && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Carrier</dt>
                    <dd className="mt-0.5 font-medium" data-testid="order-tracking-carrier">
                      {tracking.carrier}
                    </dd>
                  </div>
                )}
                {tracking.trackingNumber && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Tracking number</dt>
                    <dd className="mt-0.5 font-mono text-xs font-semibold break-all" data-testid="order-tracking-number">
                      {tracking.trackingNumber}
                    </dd>
                  </div>
                )}
                {(tracking.deliveredAt || tracking.shippedAt) && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      {tracking.deliveredAt ? "Delivered on" : "Shipped on"}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatDate((tracking.deliveredAt ?? tracking.shippedAt)!)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>
      )}

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
                {item.variation_label && <p className="text-sm text-muted-foreground">{item.variation_label}</p>}
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
            {order.discount_micros ? (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400" data-testid="order-discount-row">
                <dt>
                  Coupon{order.coupon_code ? (
                    <>
                      {" "}
                      <span className="font-mono text-xs font-bold">{order.coupon_code}</span>
                    </>
                  ) : null}
                </dt>
                <dd className="font-medium tabular-nums">−{formatMoney(order.discount_micros, orderMoney(order))}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="tabular-nums">{order.shipping_micros === 0 ? "Free" : formatMoney(order.shipping_micros, orderMoney(order))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Payment</dt>
              <dd className="text-right">
                {paymentInfo.methodLabel} ·{" "}
                {order.payment_status === "paid" ? "Paid" : order.payment_status === "refunded" ? "Refunded" : "Unpaid"}
              </dd>
            </div>
            {paymentInfo.transactionId && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {paymentInfo.isStripe ? "Stripe payment reference" : "Transaction ID (TXID)"}
                </dt>
                <dd className="font-mono text-xs break-all text-right">{paymentInfo.transactionId}</dd>
              </div>
            )}
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
            <p className="text-sm text-muted-foreground">{paymentInfo.customerNotes || "—"}</p>
          </CardContent>
        </Card>
      </div>

      {messages && (
        <OrderChat
          orderId={order.id}
          status={order.status}
          viewer="customer"
          initialMessages={messages}
          customerName={user.name ?? order.shipping_name}
          counterpart={{ name: "Admin", avatarUrl: null, presence: { online: store.online, lastActiveAt: store.lastActiveAt, visibility: store.visibility } }}
        />
      )}

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
