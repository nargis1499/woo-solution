import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getMyOrder } from "@/lib/data/orders";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ProductImage } from "@/components/product-image";
import { ButtonLink } from "@/components/ui/button";
import { CheckIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Order details" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ placed?: string }>;

export default function OrderPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="container-page py-10">
      <Suspense fallback={<div className="card h-64 animate-pulse" aria-busy />}>
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
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
            <CheckIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="font-semibold">Thank you. Your order has been received!</p>
            <p className="text-sm">
              We&apos;ve sent a confirmation to {order.customer_email ?? "your e-mail"}. Pay in cash when it arrives.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">
            <Link href="/orders" className="hover:text-neutral-900">My orders</Link> / {formatOrderNumber(order.order_number)}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Order {formatOrderNumber(order.order_number)}</h1>
          <p className="mt-1 text-sm text-neutral-500">Placed on {formatDate(order.created_at)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <section className="card overflow-hidden">
        <ul className="divide-y divide-neutral-200">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 p-4 sm:p-5">
              <div className="w-16 shrink-0 overflow-hidden rounded-lg">
                <ProductImage src={item.image_url} alt={item.product_name} sizes="64px" />
              </div>
              <div className="flex-1">
                {item.product_slug ? (
                  <Link href={`/products/${item.product_slug}`} className="font-medium hover:text-brand-700 dark:hover:text-brand-300">
                    {item.product_name}
                  </Link>
                ) : (
                  <p className="font-medium">{item.product_name}</p>
                )}
                <p className="text-sm text-neutral-500">
                  {formatPrice(item.unit_price_cents, order.currency)} × {item.quantity}
                </p>
              </div>
              <p className="font-semibold">{formatPrice(item.line_total_cents, order.currency)}</p>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-neutral-200 bg-neutral-50 p-5 text-sm">
          <div className="flex justify-between"><dt className="text-neutral-600">Subtotal</dt><dd>{formatPrice(order.subtotal_cents, order.currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-neutral-600">Shipping</dt><dd>{order.shipping_cents === 0 ? "Free" : formatPrice(order.shipping_cents, order.currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-neutral-600">Payment</dt><dd>{order.payment_method === "cod" ? "Cash on delivery" : order.payment_method} · {order.payment_status === "paid" ? "Paid" : order.payment_status === "refunded" ? "Refunded" : "Unpaid"}</dd></div>
          <div className="flex justify-between border-t border-neutral-200 pt-3 text-base font-semibold"><dt>Total</dt><dd>{formatPrice(order.total_cents, order.currency)}</dd></div>
        </dl>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Shipping address</h2>
          <address className="text-sm not-italic leading-relaxed text-neutral-700">
            {order.shipping_name}<br />
            {order.shipping_address_line1}<br />
            {order.shipping_address_line2 && <>{order.shipping_address_line2}<br /></>}
            {order.shipping_city}{order.shipping_postal_code ? `, ${order.shipping_postal_code}` : ""}<br />
            {order.shipping_country}
            {order.shipping_phone && <><br />{order.shipping_phone}</>}
          </address>
        </div>
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Order notes</h2>
          <p className="text-sm text-neutral-700">{order.notes || "—"}</p>
        </div>
      </section>

      <div className="flex gap-3">
        <ButtonLink href="/shop" variant="outline">Continue shopping</ButtonLink>
        <ButtonLink href="/orders" variant="ghost">All orders</ButtonLink>
      </div>
    </div>
  );
}
