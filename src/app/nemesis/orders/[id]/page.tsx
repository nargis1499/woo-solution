import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrder } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/auth";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { listOrderMessagesOrNull } from "@/lib/order-messages";
import { parseOrderPaymentInfo } from "@/lib/order-payment";
import { getCustomerVisibility, getPersonPresence } from "@/lib/presence.server";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { deleteOrder } from "@/app/nemesis/actions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-status-badge";
import { OrderStatusForm } from "@/components/admin/order-form";
import { CopyValueButton } from "@/components/admin/copy-value-button";
import { DeleteButton } from "@/components/admin/form-bits";
import { OrderChat } from "@/components/order-chat/order-chat";
import { DescriptionList, PageHeader, Section, Thumb, ToneBadge } from "@/components/admin/ui";
import { Separator } from "@/components/ui/separator";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back + delete return to the exact list page (page / size / filter) the admin came from.
  const backHref = safeListReturn(from, "/nemesis/orders") ?? "/nemesis/orders";
  const [order, { manage_stock }, user] = await Promise.all([
    adminGetOrder(id),
    getSiteSettingsFresh(),
    requireAdmin(`/nemesis/orders/${id}`),
  ]);
  if (!order) notFound();
  // `null` = migration 17 not run yet → the thread is simply not shown.
  const [messages, buyer, visibility] = await Promise.all([
    listOrderMessagesOrNull(order.id),
    order.user_id
      ? getPersonPresence(order.user_id)
      : Promise.resolve({ online: false, lastActiveAt: null, name: null, avatarUrl: null }),
    // What *this* buyer sees: their own override row, else the admin's global switch.
    getCustomerVisibility(user.id, order.user_id),
  ]);
  const items = order.order_items ?? [];
  const paymentInfo = parseOrderPaymentInfo(order);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Order {formatOrderNumber(order.order_number)}{" "}
            <OrderStatusBadge status={order.status} />
          </span>
        }
        description={`Placed ${formatDate(order.created_at)} · ${paymentInfo.shortMethodLabel} · ${order.payment_status}`}
        backHref={backHref}
        backLabel="Orders"
        actions={
          <DeleteButton
            action={deleteOrder}
            id={order.id}
            returnTo={backHref}
            label="Delete order"
            size="default"
            title={`Delete order ${formatOrderNumber(order.order_number)}?`}
            description="The order and its line items are removed permanently. This cannot be undone."
          />
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
                      {item.variation_label && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {item.variation_label}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(item.unit_price_micros, orderMoney(order))} × {item.quantity}
                      {item.product_slug && (
                        <>
                          {" "}
                          ·{" "}
                          <Link
                            href={`/products/${item.product_slug}`}
                            target="_blank"
                            className="hover:underline"
                          >
                            view
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <p className="font-medium tabular-nums">
                    {formatMoney(item.line_total_micros, orderMoney(order))}
                  </p>
                </li>
              ))}
            </ul>
            <Separator />
            <dl className="space-y-1 px-6 py-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">
                  {formatMoney(order.subtotal_micros, orderMoney(order))}
                </dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Shipping</dt>
                <dd className="tabular-nums">
                  {order.shipping_micros === 0
                    ? "Free"
                    : formatMoney(order.shipping_micros, orderMoney(order))}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {formatMoney(order.total_micros, orderMoney(order))}
                </dd>
              </div>
            </dl>
          </Section>

          <div data-testid="admin-order-payment-section">
            <Section title="Payment information">
              <div className="space-y-4 text-sm">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Payment method
                    </dt>
                    <dd
                      className="mt-1 font-medium"
                      data-testid="admin-order-payment-method"
                    >
                      {paymentInfo.isCrypto ? "Cryptocurrency" : "Cash on Delivery (COD)"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Payment status
                    </dt>
                    <dd className="mt-1">
                      <PaymentStatusBadge status={order.payment_status} />
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Amount
                    </dt>
                    <dd className="mt-1 font-semibold tabular-nums">
                      {formatMoney(order.total_micros, orderMoney(order))}
                    </dd>
                  </div>
                </dl>

                {paymentInfo.isCrypto && (
                  <>
                    <dl className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Crypto protocol
                        </dt>
                        <dd className="mt-1 font-medium">
                          {paymentInfo.protocolName
                            ? paymentInfo.protocolCode &&
                              paymentInfo.protocolName !== paymentInfo.protocolCode
                              ? `${paymentInfo.protocolName} (${paymentInfo.protocolCode})`
                              : paymentInfo.protocolName
                            : (paymentInfo.protocolCode ?? "—")}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Network
                        </dt>
                        <dd className="mt-1 font-medium">
                          {paymentInfo.network ?? "—"}
                        </dd>
                      </div>
                    </dl>

                    <div className="border-t pt-4">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Transaction ID (TXID)
                      </p>
                      {paymentInfo.transactionId ? (
                        <div
                          className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center"
                          data-testid="admin-order-txid"
                        >
                          <code className="flex-1 rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-2 font-mono text-xs font-semibold text-foreground break-all">
                            {paymentInfo.transactionId}
                          </code>
                          <CopyValueButton
                            value={paymentInfo.transactionId}
                            label="Copy TXID"
                          />
                        </div>
                      ) : (
                        <p className="mt-1 text-muted-foreground">—</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Section>
          </div>

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
                    <Link
                      href={`/nemesis/users/${order.user_id}`}
                      className="text-primary hover:underline"
                    >
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
                { label: "Customer notes", value: paymentInfo.customerNotes },
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

      {/* `mt-6` keeps the thread clear of the two cards above it – it sits outside the grid. */}
      {messages && (
        <div className="mt-6">
          <OrderChat
            orderId={order.id}
            status={order.status}
            viewer="admin"
            initialMessages={messages}
            customerName={order.shipping_name}
            customerId={order.user_id}
            visibility={visibility}
            counterpart={{
              name: buyer.name ?? order.shipping_name ?? "Customer",
              avatarUrl: buyer.avatarUrl,
              presence: { online: buyer.online, lastActiveAt: buyer.lastActiveAt },
            }}
          />
        </div>
      )}
    </>
  );
}
