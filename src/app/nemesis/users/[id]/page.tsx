import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetUser } from "@/lib/admin/data";
import { getAdminStatus } from "@/lib/admin/auth";
import { formatDate, formatOrderNumber, formatPrice } from "@/lib/format";
import { deleteUser } from "@/app/nemesis/actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { UserForm } from "@/components/admin/user-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { Badge, DescriptionList, PageHeader, Section, StatCard } from "@/components/admin/ui";
import { UserAvatar } from "@/components/admin/user-avatar";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back + delete return to the exact list page (page / size / search) the admin came from.
  const backHref = safeListReturn(from, "/nemesis/users") ?? "/nemesis/users";
  const [profile, { user: me }] = await Promise.all([adminGetUser(id), getAdminStatus()]);
  if (!profile) notFound();
  const isSelf = me?.id === profile.id;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <UserAvatar name={profile.full_name} email={profile.email} src={profile.avatar_url} size="lg" />
            {profile.full_name || profile.email || "User"}
            {profile.is_admin && <Badge tone="brand">Admin</Badge>}
          </span>
        }
        description={`Joined ${formatDate(profile.created_at)}`}
        backHref={backHref}
        backLabel="Users"
        actions={
          !isSelf && (
            <ConfirmForm action={deleteUser} message={`Delete ${profile.email ?? "this user"}? Their account is removed permanently; orders are kept.`}>
              <input type="hidden" name="id" value={profile.id} />
              <input type="hidden" name="return_to" value={backHref} />
              <DeleteButton label="Delete user" size="md" />
            </ConfirmForm>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Orders" value={profile.order_count} accent="emerald" />
            <StatCard label="Total spent" value={formatPrice(profile.total_spent_cents)} hint="Excluding cancelled orders" accent="brand" />
          </div>

          <Section title="Orders" className="p-0 sm:p-0">
            {profile.orders && profile.orders.length > 0 ? (
              <ul className="divide-y divide-neutral-200">
                {profile.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                    <Link href={`/nemesis/orders/${o.id}`} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">{formatOrderNumber(o.order_number)}</Link>
                    <span className="text-neutral-500">{formatDate(o.created_at)}</span>
                    <OrderStatusBadge status={o.status} />
                    <span className="ml-auto font-medium tabular-nums">{formatPrice(o.total_cents, o.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-neutral-500">No orders yet.</p>
            )}
          </Section>

          <Section title="Account">
            <DescriptionList
              items={[
                { label: "User id", value: <code className="text-xs">{profile.id}</code> },
                { label: "E-mail", value: profile.email },
                { label: "Phone", value: profile.phone },
                { label: "Last updated", value: formatDate(profile.updated_at) },
              ]}
            />
          </Section>
        </div>

        <Section title="Edit user">
          <UserForm profile={profile} isSelf={isSelf} />
        </Section>
      </div>
    </>
  );
}
