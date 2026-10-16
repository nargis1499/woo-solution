import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrder } from "@/lib/admin/data";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { listOrderMessagesOrNull } from "@/lib/order-messages";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { deleteOrder } from "@/app/nemesis/actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { OrderStatusForm } from "@/components/admin/order-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { OrderChat } from "@/components/order-chat/order-chat";
import { DescriptionList, PageHeader, Section, Thumb, ToneBadge } from "@/components/admin/ui";
import { Separator } from "@/components/ui/separator";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back + delete return to the exact list page (page / size / filter) the admin came from.
  const backHref = safeListReturn(from, "/nemesis/orders") ?? "/nemesis/orders";
  const [order, { manage_stock }] = await Promise.all([adminGetOrder(id), getSiteSettingsFresh()]);
  if (!order) notFound();
  // `null` = migration 17 not run yet → the thread is simply not shown.
  const messages = await listOrderMessagesOrNull(order.id);
  const items = order.order_items ?? [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Order {formatOrderNumber(order.order_number)} <OrderStatusBadge status={order.status} />
          </span>
        }
        description={`Placed ${formatDate(order.created_at)} · ${order.payment_method.toUpperCase()} · ${order.payment_status}`}
        backHref={backHref}
        backLabel="Orders"
        actions={
          <DeleteButton action={deleteOrder} id={order.id} returnTo={backHref} label="Delete order" size="default" title={`Delete order ${formatOrderNumber(order.order_number)}?`} description="The order and its line items are removed permanently. This cannot be undone." />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Section title={`Items (${items.reduce((n, i) => n + i.quantity, 0)})`} flush>
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-6 py-4">
                  <Thumb src={item.image_url} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {item.product_name}
                      {item.variation_label && <span className="ml-2 text-xs font-normal text-muted-foreground">{item.variation_label}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(item.unit_price_micros, orderMoney(order))} × {item.quantity}
                      {item.product_slug && (
                        <>
                          {" "}
                          ·{" "}
                          <Link href={`/products/${item.product_slug}`} target="_blank" className="hover:underline">
                            view
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <p className="font-medium tabular-nums">{formatMoney(item.line_total_micros, orderMoney(order))}</p>
                </li>
              ))}
            </ul>
            <Separator />
            <dl className="space-y-1 px-6 py-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(order.subtotal_micros, orderMoney(order))}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Shipping</dt>
                <dd className="tabular-nums">{order.shipping_micros === 0 ? "Free" : formatMoney(order.shipping_micros, orderMoney(order))}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(order.total_micros, orderMoney(order))}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Customer & shipping">
            <DescriptionList
              items={[
                { label: "Name", value: order.shipping_name },
                {
                  label: "E-mail",
                  value: order.customer_email ? (
                    <a href={`mailto:${order.customer_email}`} className="hover:underline">
                      {order.customer_email}
                    </a>
                  ) : null,
                },
                { label: "Phone", value: order.shipping_phone },
                {
                  label: "Account",
                  value: order.user_id ? (
                    <Link href={`/nemesis/users/${order.user_id}`} className="text-primary hover:underline">
                      View customer
                    </Link>
                  ) : (
                    <ToneBadge>Guest / deleted</ToneBadge>
                  ),
                },
                {
                  label: "Address",
                  value: (
                    <>
                      {order.shipping_address_line1}
                      {order.shipping_address_line2 && (
                        <>
                          <br />
                          {order.shipping_address_line2}
                        </>
                      )}
                      <br />
                      {order.shipping_city}
                      {order.shipping_postal_code ? ` ${order.shipping_postal_code}` : ""}
                      <br />
                      {order.shipping_country}
                    </>
                  ),
                },
                { label: "Customer notes", value: order.notes },
              ]}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Update status">
            <OrderStatusForm order={order} manageStock={manage_stock} />
          </Section>
        </div>
      </div>

      {messages && <OrderChat orderId={order.id} status={order.status} viewer="admin" initialMessages={messages} customerName={order.shipping_name} />}
    </>
  );
}
