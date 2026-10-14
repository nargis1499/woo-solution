import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetOrder } from "@/lib/admin/data";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { deleteOrder } from "@/app/nemesis/actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { OrderStatusForm } from "@/components/admin/order-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { Badge, DescriptionList, PageHeader, Section, Thumb } from "@/components/admin/ui";
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
  const order = await adminGetOrder(id);
  if (!order) notFound();
  const items = order.order_items ?? [];

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3">Order {formatOrderNumber(order.order_number)} <OrderStatusBadge status={order.status} /></span>}
        description={`Placed ${formatDate(order.created_at)} · ${order.payment_method.toUpperCase()} · ${order.payment_status}`}
        backHref={backHref}
        backLabel="Orders"
        actions={
          <ConfirmForm action={deleteOrder} message={`Delete order ${formatOrderNumber(order.order_number)}? This cannot be undone.`}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="return_to" value={backHref} />
            <DeleteButton label="Delete order" size="md" />
          </ConfirmForm>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Section title={`Items (${items.reduce((n, i) => n + i.quantity, 0)})`} className="p-0 sm:p-0">
            <ul className="divide-y divide-neutral-200">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-5 py-4">
                  <Thumb src={item.image_url} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.product_name}</p>
                    <p className="text-xs text-neutral-500">
                      {formatPrice(item.unit_price_cents, order.currency)} × {item.quantity}
                      {item.product_slug && (
                        <> · <Link href={`/products/${item.product_slug}`} target="_blank" className="hover:underline">view</Link></>
                      )}
                    </p>
                  </div>
                  <p className="font-medium tabular-nums">{formatPrice(item.line_total_cents, order.currency)}</p>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-neutral-200 px-5 py-4 text-sm">
              <div className="flex justify-between text-neutral-600"><dt>Subtotal</dt><dd className="tabular-nums">{formatPrice(order.subtotal_cents, order.currency)}</dd></div>
              <div className="flex justify-between text-neutral-600"><dt>Shipping</dt><dd className="tabular-nums">{order.shipping_cents === 0 ? "Free" : formatPrice(order.shipping_cents, order.currency)}</dd></div>
              <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPrice(order.total_cents, order.currency)}</dd></div>
            </dl>
          </Section>

          <Section title="Customer & shipping">
            <DescriptionList
              items={[
                { label: "Name", value: order.shipping_name },
                { label: "E-mail", value: order.customer_email ? <a href={`mailto:${order.customer_email}`} className="hover:underline">{order.customer_email}</a> : null },
                { label: "Phone", value: order.shipping_phone },
                { label: "Account", value: order.user_id ? <Link href={`/nemesis/users/${order.user_id}`} className="text-brand-700 dark:text-brand-300 hover:underline">View customer</Link> : <Badge>Guest / deleted</Badge> },
                {
                  label: "Address",
                  value: (
                    <>
                      {order.shipping_address_line1}
                      {order.shipping_address_line2 && <><br />{order.shipping_address_line2}</>}
                      <br />
                      {order.shipping_city}{order.shipping_postal_code ? ` ${order.shipping_postal_code}` : ""}
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
            <OrderStatusForm order={order} />
          </Section>
        </div>
      </div>
    </>
  );
}
