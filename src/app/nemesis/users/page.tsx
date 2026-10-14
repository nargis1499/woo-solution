import type { Metadata } from "next";
import Link from "next/link";
import { adminListUsers } from "@/lib/admin/data";
import { getAdminStatus } from "@/lib/admin/auth";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate, formatPrice } from "@/lib/format";
import { deleteUser } from "@/app/nemesis/actions";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { Badge, EmptyRow, PageHeader, Table, TBody, Td, Th, THead, Tr } from "@/components/admin/ui";
import { UserAvatar } from "@/components/admin/user-avatar";

export const metadata: Metadata = { title: "Users" };

const LIST_PATH = "/nemesis/users";

type SearchParams = Promise<{ q?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = { q: sp.q?.trim() || undefined };
  const { perPage, requestedPage } = await resolveListParams(sp);

  const [{ items: users, total, page }, { user: me }] = await Promise.all([
    adminListUsers({ ...filters, page: requestedPage, perPage }),
    getAdminStatus(),
  ]);
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);

  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const detailHref = (id: string) => `/nemesis/users/${id}?from=${encodeURIComponent(listUrl)}`;

  return (
    <>
      <PageHeader title="Users" description={`${total} ${total === 1 ? "account" : "accounts"}${isFiltered ? " match your search" : ""}.`} />

      <ListToolbar {...location}>
        <SearchForm
          action={LIST_PATH}
          q={filters.q}
          placeholder="Search name, e-mail or phone…"
          isFiltered={isFiltered}
          hidden={{ per: perPage }}
          clearHref={listHref(LIST_PATH, { per: perPage })}
        />
      </ListToolbar>

      <Table>
        <THead>
          <tr>
            <Th>User</Th>
            <Th>Role</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Spent</Th>
            <Th>Joined</Th>
            <Th className="text-right"><span className="sr-only">Actions</span></Th>
          </tr>
        </THead>
        <TBody>
          {users.length === 0 && <EmptyRow colSpan={6}>{isFiltered ? "No users match your search." : "No users yet."}</EmptyRow>}
          {users.map((u) => (
            <Tr key={u.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <UserAvatar name={u.full_name} email={u.email} src={u.avatar_url} />
                  <div className="min-w-0">
                    <Link href={detailHref(u.id)} className="block truncate font-medium hover:underline">
                      {u.full_name || <span className="text-neutral-500">No name</span>}
                      {me?.id === u.id && <span className="ml-1 text-xs text-neutral-400">(you)</span>}
                    </Link>
                    <p className="truncate text-xs text-neutral-500">{u.email ?? "—"}{u.phone ? ` · ${u.phone}` : ""}</p>
                  </div>
                </div>
              </Td>
              <Td>{u.is_admin ? <Badge tone="brand">Admin</Badge> : <Badge>Customer</Badge>}</Td>
              <Td className="text-right tabular-nums">{u.order_count}</Td>
              <Td className="text-right tabular-nums">{formatPrice(u.total_spent_cents)}</Td>
              <Td className="text-neutral-600">{formatDate(u.created_at)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link href={detailHref(u.id)} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100">Edit</Link>
                  {me?.id !== u.id && (
                    <ConfirmForm action={deleteUser} message={`Delete ${u.email ?? "this user"}? Their account is removed permanently; orders are kept.`}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="return_to" value={listUrl} />
                      <DeleteButton />
                    </ConfirmForm>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <Pagination {...location} total={total} itemLabel={total === 1 ? "account" : "accounts"} />
    </>
  );
}
