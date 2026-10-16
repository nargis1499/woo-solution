import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetUser } from "@/lib/admin/data";
import { getAdminStatus } from "@/lib/admin/auth";
import { formatDate, formatOrderNumber } from "@/lib/format";
import { formatMoney, orderMoney } from "@/lib/money";
import { getMoney } from "@/lib/site-settings";
import { deleteUser } from "@/app/nemesis/actions";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { UserForm } from "@/components/admin/user-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { DescriptionList, PageHeader, Section, StatCard, ToneBadge } from "@/components/admin/ui";
import { UserAvatar } from "@/components/admin/user-avatar";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back + delete return to the exact list page (page / size / search) the admin came from.
  const backHref = safeListReturn(from, "/nemesis/users") ?? "/nemesis/users";
  const [profile, { user: me }, money] = await Promise.all([adminGetUser(id), getAdminStatus(), getMoney()]);
  if (!profile) notFound();
  const isSelf = me?.id === profile.id;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <UserAvatar name={profile.full_name} email={profile.email} src={profile.avatar_url} size="lg" />
            {profile.full_name || profile.email || "User"}
            {profile.is_admin && <ToneBadge tone="brand">Admin</ToneBadge>}
          </span>
        }
        description={`Joined ${formatDate(profile.created_at)}`}
        backHref={backHref}
        backLabel="Users"
        actions={
          !isSelf && (
            <DeleteButton action={deleteUser} id={profile.id} returnTo={backHref} label="Delete user" size="default" title={`Delete ${profile.email ?? "this user"}?`} description="Their account is removed permanently; orders are kept." />
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Orders" value={profile.order_count} />
            <StatCard label="Total spent" value={formatMoney(profile.total_spent_micros, money)} hint="Excluding cancelled orders" />
          </div>
          <Section title="Orders" flush>
            {profile.orders && profile.orders.length > 0 ? (
              <ul className="divide-y">
                {profile.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-4 px-6 py-3 text-sm">
                    <Link href={`/nemesis/orders/${o.id}`} className="font-medium text-primary hover:underline">
                      {formatOrderNumber(o.order_number)}
                    </Link>
                    <span className="text-muted-foreground">{formatDate(o.created_at)}</span>
                    <OrderStatusBadge status={o.status} />
                    <span className="ml-auto font-medium tabular-nums">{formatMoney(o.total_micros, orderMoney(o))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">No orders yet.</p>
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
