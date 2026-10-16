import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";
import { adminListOrders } from "@/lib/admin/data";
import { ORDER_STATUSES } from "@/lib/admin/constants";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { deleteOrder, deleteOrders } from "@/app/nemesis/actions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-status-badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { FilterSelect } from "@/components/admin/filter-select";
import { DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Orders" };

const LIST_PATH = "/nemesis/orders";

type SearchParams = Promise<{ q?: string; status?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = { q: sp.q?.trim() || undefined, status: sp.status || undefined };
  const { perPage, requestedPage } = await resolveListParams(sp);
  const { items: orders, total, page } = await adminListOrders({ ...filters, page: requestedPage, perPage });
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);

  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q || filters.status);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const detailHref = (id: string) => `/nemesis/orders/${id}?from=${encodeURIComponent(listUrl)}`;

  return (
    <>
      <PageHeader title="Orders" description={`${total} ${total === 1 ? "order" : "orders"}${isFiltered ? " match your filter" : ""}.`} />

      <ListToolbar {...location}>
        <SearchForm action={LIST_PATH} q={filters.q} placeholder="Search #, name or e-mail…" isFiltered={isFiltered} hidden={{ per: perPage }} clearHref={listHref(LIST_PATH, { per: perPage })}>
          <FilterSelect name="status" label="Status" defaultValue={filters.status ?? ""} options={[{ value: "", label: "All statuses" }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]} />
        </SearchForm>
      </ListToolbar>

      {orders.length === 0 ? (
        <EmptyState title={isFiltered ? "No orders match your filter." : "No orders yet."} icon={<ShoppingCartIcon />} />
      ) : (
        <DataTable
          label="Orders"
          columns={[
            { id: "order", label: "Order", className: "pl-4" },
            { id: "customer", label: "Customer" },
            { id: "status", label: "Status" },
            { id: "payment", label: "Payment" },
            { id: "total", label: "Total", align: "right", cellClassName: "tabular-nums" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          bulkDelete={{
            action: deleteOrders,
            returnTo: listUrl,
            noun: ["order", "orders"],
            description: "The selected orders and their line items are removed permanently (cancel an order instead if you want its stock back). This cannot be undone.",
          }}
          rows={orders.map((o) => {
            const items = (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0);
            return {
              id: o.id,
              href: detailHref(o.id),
              cells: [
                <div key="o">
                  <Link href={detailHref(o.id)} className="font-medium text-primary hover:underline">
                    {formatOrderNumber(o.order_number)}
                  </Link>
                  <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
                </div>,
                <div key="c" className="min-w-0">
                  <p className="truncate">{o.shipping_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.customer_email ?? "—"}</p>
                </div>,
                <OrderStatusBadge key="s" status={o.status} />,
                <div key="p">
                  <PaymentStatusBadge status={o.payment_status} />
                  <p className="mt-1 text-xs text-muted-foreground uppercase">{o.payment_method}</p>
                </div>,
                <div key="t">
                  <span className="font-medium">{formatMoney(o.total_micros, orderMoney(o))}</span>
                  <p className="text-xs text-muted-foreground">
                    {items} {items === 1 ? "item" : "items"}
                  </p>
                </div>,
                <div key="a" className="flex items-center justify-end gap-2">
                  <Link href={detailHref(o.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    View
                  </Link>
                  <DeleteButton action={deleteOrder} id={o.id} returnTo={listUrl} title={`Delete order ${formatOrderNumber(o.order_number)}?`} description="The order and its line items are removed permanently. This cannot be undone." />
                </div>,
              ],
            };
          })}
        />
      )}

      <Pagination {...location} total={total} itemLabel={total === 1 ? "order" : "orders"} />
    </>
  );
}
