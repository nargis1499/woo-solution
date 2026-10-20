import type { Metadata } from "next";
import Link from "next/link";
import { SquarePenIcon, UsersIcon } from "lucide-react";
import { adminListUsers } from "@/lib/admin/data";
import { getAdminStatus } from "@/lib/admin/auth";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getMoney } from "@/lib/site-settings";
import { deleteUser, deleteUsers } from "@/app/nemesis/actions";
import { buttonVariants } from "@/components/ui/button-variants";
import { DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader, ToneBadge } from "@/components/admin/ui";
import { UserAvatar } from "@/components/admin/user-avatar";
import { CreateUserDialog } from "@/components/admin/users/create-user-dialog";

export const metadata: Metadata = { title: "Users" };

const LIST_PATH = "/nemesis/users";

type SearchParams = Promise<{ q?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = { q: sp.q?.trim() || undefined };
  const { perPage, requestedPage } = await resolveListParams(sp);
  const [{ items: users, total, page }, { user: me }, money] = await Promise.all([adminListUsers({ ...filters, page: requestedPage, perPage }), getAdminStatus(), getMoney()]);
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);

  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const detailHref = (id: string) => `/nemesis/users/${id}?from=${encodeURIComponent(listUrl)}`;

  return (
    <>
      <PageHeader
        title="Users"
        description={`${total} ${total === 1 ? "account" : "accounts"}${isFiltered ? " match your search" : ""}.`}
        actions={<CreateUserDialog />}
      />

      <ListToolbar {...location}>
        <SearchForm action={LIST_PATH} q={filters.q} placeholder="Search name, e-mail or phone…" isFiltered={isFiltered} hidden={{ per: perPage }} clearHref={listHref(LIST_PATH, { per: perPage })} />
      </ListToolbar>

      {users.length === 0 ? (
        <EmptyState title={isFiltered ? "No users match your search." : "No users yet."} icon={<UsersIcon />} />
      ) : (
        <DataTable
          label="Users"
          columns={[
            { id: "user", label: "User", className: "pl-4" },
            { id: "role", label: "Role" },
            { id: "orders", label: "Orders", align: "right", cellClassName: "tabular-nums" },
            { id: "spent", label: "Spent", align: "right", cellClassName: "tabular-nums" },
            { id: "joined", label: "Joined", cellClassName: "text-muted-foreground" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          bulkDelete={{
            action: deleteUsers,
            returnTo: listUrl,
            noun: ["user", "users"],
            description: "The selected accounts are removed permanently; their orders are kept for your records. This cannot be undone.",
          }}
          rows={users.map((u) => ({
            id: u.id,
            href: detailHref(u.id),
            unselectable: me?.id === u.id,
            cells: [
              <div key="u" className="flex items-center gap-3">
                <UserAvatar name={u.full_name} email={u.email} src={u.avatar_url} />
                <div className="min-w-0">
                  <Link href={detailHref(u.id)} className="block truncate font-medium hover:underline">
                    {u.full_name || <span className="text-muted-foreground">No name</span>}
                    {me?.id === u.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email ?? "—"}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                </div>
              </div>,
              u.is_admin ? <ToneBadge key="r" tone="brand">Admin</ToneBadge> : <ToneBadge key="r">Customer</ToneBadge>,
              u.order_count,
              formatMoney(u.total_spent_micros, money),
              formatDate(u.created_at),
              <div key="a" className="flex items-center justify-end gap-1.5">
                <Link
                  href={detailHref(u.id)}
                  aria-label={`Edit ${u.full_name || u.email || "user"}`}
                  title={`Edit ${u.full_name || u.email || "user"}`}
                  className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                >
                  <SquarePenIcon className="size-4" />
                </Link>
                {me?.id !== u.id && (
                  <DeleteButton action={deleteUser} id={u.id} returnTo={listUrl} title={`Delete ${u.email ?? "this user"}?`} description="Their account is removed permanently; orders are kept." />
                )}
              </div>,
            ],
          }))}
        />
      )}

      <Pagination {...location} total={total} itemLabel={total === 1 ? "account" : "accounts"} />
    </>
  );
}
