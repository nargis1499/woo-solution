import type { Metadata } from "next";
import Link from "next/link";
import { adminListOrders } from "@/lib/admin/data";
import { ORDER_STATUSES } from "@/lib/admin/constants";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { deleteOrder } from "@/app/nemesis/actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { Badge, EmptyRow, PageHeader, Table, TBody, Td, Th, THead, Tr } from "@/components/admin/ui";

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
        <SearchForm
          action={LIST_PATH}
          q={filters.q}
          placeholder="Search #, name or e-mail…"
          isFiltered={isFiltered}
          hidden={{ per: perPage }}
          clearHref={listHref(LIST_PATH, { per: perPage })}
        >
          <select name="status" defaultValue={filters.status ?? ""} className="input-base w-auto capitalize" aria-label="Status">
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </SearchForm>
      </ListToolbar>

      <Table>
        <THead>
          <tr>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th>Payment</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right"><span className="sr-only">Actions</span></Th>
          </tr>
        </THead>
        <TBody>
          {orders.length === 0 && <EmptyRow colSpan={6}>{isFiltered ? "No orders match your filter." : "No orders yet."}</EmptyRow>}
          {orders.map((o) => {
            const items = (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0);
            return (
              <Tr key={o.id}>
                <Td>
                  <Link href={detailHref(o.id)} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">{formatOrderNumber(o.order_number)}</Link>
                  <p className="text-xs text-neutral-500">{formatDate(o.created_at)}</p>
                </Td>
                <Td>
                  <p className="truncate">{o.shipping_name}</p>
                  <p className="truncate text-xs text-neutral-500">{o.customer_email ?? "—"}</p>
                </Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
                <Td>
                  <Badge tone={o.payment_status === "paid" ? "emerald" : o.payment_status === "refunded" ? "neutral" : "amber"}>{o.payment_status}</Badge>
                  <p className="mt-1 text-xs uppercase text-neutral-500">{o.payment_method}</p>
                </Td>
                <Td className="text-right tabular-nums">
                  <span className="font-medium">{formatPrice(o.total_cents, o.currency)}</span>
                  <p className="text-xs text-neutral-500">{items} {items === 1 ? "item" : "items"}</p>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link href={detailHref(o.id)} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100">View</Link>
                    <ConfirmForm action={deleteOrder} message={`Delete order ${formatOrderNumber(o.order_number)}? This cannot be undone.`}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="return_to" value={listUrl} />
                      <DeleteButton />
                    </ConfirmForm>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      <Pagination {...location} total={total} itemLabel={total === 1 ? "order" : "orders"} />
    </>
  );
}
