import Link from "next/link";
import { adminGetLowStockProducts, adminGetRecentOrders, adminGetStats } from "@/lib/admin/data";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyRow, PageHeader, Section, StatCard, TBody, THead, Table, Td, Th, Thumb, Tr } from "@/components/admin/ui";

export default async function AdminDashboardPage() {
  const [stats, recentOrders, lowStock] = await Promise.all([
    adminGetStats(),
    adminGetRecentOrders(6),
    adminGetLowStockProducts(6),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What's happening in your store."
        actions={<ButtonLink href="/nemesis/products/new">+ New product</ButtonLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatPrice(stats.revenue_cents)} hint={`${formatPrice(stats.revenue_30d_cents)} in the last 30 days`} accent="brand" />
        <StatCard label="Orders" value={stats.orders_total} hint={`${stats.orders_30d} in the last 30 days · ${stats.orders_pending} pending`} accent="emerald" />
        <StatCard label="Products" value={stats.products_total} hint={`${stats.products_active} active · ${stats.products_low_stock} low on stock`} accent="amber" />
        <StatCard label="Customers" value={stats.customers_total} hint={`${stats.customers_30d} joined in the last 30 days`} accent="neutral" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        {(
          [
            ["pending", stats.orders_pending, "amber"],
            ["processing", stats.orders_processing, "blue"],
            ["completed", stats.orders_completed, "emerald"],
            ["cancelled", stats.orders_cancelled, "neutral"],
          ] as const
        ).map(([status, count, tone]) => (
          <Link key={status} href={`/nemesis/orders?status=${status}`} className="card flex items-center justify-between px-4 py-3 transition-colors hover:border-brand-300">
            <Badge tone={tone}>{status}</Badge>
            <span className="text-lg font-semibold tabular-nums">{count}</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 *:min-w-0 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Recent orders" actions={<Link href="/nemesis/orders" className="text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">View all →</Link>} className="p-0 sm:p-0">
          <Table className="border-0 shadow-none" tableClassName="min-w-[480px]">
            <THead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <TBody>
              {recentOrders.length === 0 && <EmptyRow colSpan={4}>No orders yet.</EmptyRow>}
              {recentOrders.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <Link href={`/nemesis/orders/${o.id}`} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">{formatOrderNumber(o.order_number)}</Link>
                    <p className="text-xs text-neutral-500">{formatDate(o.created_at)}</p>
                  </Td>
                  <Td>
                    <p className="truncate">{o.shipping_name}</p>
                    <p className="truncate text-xs text-neutral-500">{o.customer_email}</p>
                  </Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td className="text-right font-medium tabular-nums">{formatPrice(o.total_cents, o.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title="Low stock" actions={<Link href="/nemesis/products" className="text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">All products →</Link>}>
          {lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">Everything is well stocked. 🎉</p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <Thumb src={p.image_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/nemesis/products/${p.id}`} className="block truncate text-sm font-medium hover:underline">{p.name}</Link>
                    <p className="text-xs text-neutral-500">{formatPrice(p.price_cents)}</p>
                  </div>
                  <Badge tone={p.stock === 0 ? "red" : "amber"}>{p.stock === 0 ? "Sold out" : `${p.stock} left`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
