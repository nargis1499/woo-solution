import Link from "next/link";
import { ArrowRightIcon, BanknoteIcon, DollarSignIcon, PackageIcon, PlusIcon, ShoppingCartIcon, UsersIcon } from "lucide-react";
import { adminGetLowStockProducts, adminGetRecentOrders, adminGetStats } from "@/lib/admin/data";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, moneyFromSettings, orderMoney } from "@/lib/money";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid";
import { PageHeader, Section, StatCard, Thumb, ToneBadge } from "@/components/admin/ui";

export default async function AdminDashboardPage() {
  const settings = await getSiteSettingsFresh();
  const manageStock = settings.manage_stock;
  const money = moneyFromSettings(settings); // base-currency totals shown in the store currency at today's rate
  const [stats, recentOrders, lowStock] = await Promise.all([
    adminGetStats(),
    adminGetRecentOrders(6),
    manageStock ? adminGetLowStockProducts(6) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What's happening in your store."
        actions={
          <Link href="/nemesis/products/new" className={buttonVariants()}>
            <PlusIcon /> New product
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(stats.revenue_micros, money)} hint={`${formatMoney(stats.revenue_30d_micros, money)} in the last 30 days`} icon={money.currency === "USD" ? <DollarSignIcon /> : <BanknoteIcon />} />
        <StatCard label="Orders" value={stats.orders_total} hint={`${stats.orders_30d} in the last 30 days · ${stats.orders_pending} pending`} icon={<ShoppingCartIcon />} />
        <StatCard label="Products" value={stats.products_total} hint={manageStock ? `${stats.products_active} active · ${stats.products_low_stock} low on stock` : `${stats.products_active} active · stock not tracked`} icon={<PackageIcon />} />
        <StatCard label="Customers" value={stats.customers_total ?? 0} hint={`${stats.customers_30d ?? 0} joined in the last 30 days`} icon={<UsersIcon />} />
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
          <Card key={status} size="sm" className="py-0 transition-colors hover:bg-accent/60">
            <Link href={`/nemesis/orders?status=${status}`} className="flex items-center justify-between px-4 py-3">
              <ToneBadge tone={tone}>{status}</ToneBadge>
              <span className="text-lg font-semibold tabular-nums">{count}</span>
            </Link>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 *:min-w-0 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Recent orders"
          flush
          actions={
            <Link href="/nemesis/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              View all <ArrowRightIcon />
            </Link>
          }
        >
          {recentOrders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <DataGrid
              label="Recent orders"
              className="min-w-[480px]"
              columns={[
                { id: "order", label: "Order", className: "pl-6" },
                { id: "customer", label: "Customer" },
                { id: "status", label: "Status" },
                { id: "total", label: "Total", align: "right", className: "pr-6", cellClassName: "font-medium tabular-nums" },
              ]}
              rows={recentOrders.map((o) => ({
                id: o.id,
                cells: [
                  <div key="o">
                    <Link href={`/nemesis/orders/${o.id}`} className="font-medium text-primary hover:underline">
                      {formatOrderNumber(o.order_number)}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
                  </div>,
                  <div key="c" className="min-w-0">
                    <p className="truncate">{o.shipping_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{o.customer_email}</p>
                  </div>,
                  <OrderStatusBadge key="s" status={o.status} />,
                  formatMoney(o.total_micros, orderMoney(o)),
                ],
              }))}
            />
          )}
        </Section>

        <Section
          title="Low stock"
          flush
          actions={
            <Link href="/nemesis/products" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              All products <ArrowRightIcon />
            </Link>
          }
        >
          {!manageStock ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Stock management is off – every product is unlimited.{" "}
              <Link href="/nemesis/settings?tab=woocommerce" className="text-primary hover:underline">
                Change in Settings
              </Link>
              .
            </p>
          ) : lowStock.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Everything is well stocked. 🎉</p>
          ) : (
            <ul className="divide-y">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-6 py-3">
                  <Thumb src={p.image_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/nemesis/products/${p.id}`} className="block truncate text-sm font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatMoney(p.price_micros, money)}</p>
                  </div>
                  <ToneBadge tone={p.stock === 0 ? "red" : "amber"}>{p.stock === 0 ? "Sold out" : `${p.stock} left`}</ToneBadge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
