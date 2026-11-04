import type { Metadata } from "next";
import Link from "next/link";
import { CopyPlusIcon, PauseIcon, PlayIcon, PlusIcon, SquarePenIcon, TicketPercentIcon } from "lucide-react";
import { adminListCoupons } from "@/lib/admin/data";
import { COUPON_STATUS_LABELS, couponStatus, couponUsagePercent, describeCoupon, type CouponStatus } from "@/lib/coupons";
import { formatMoney } from "@/lib/money";
import { getMoney } from "@/lib/site-settings";
import type { Coupon } from "@/lib/types";
import { deleteCoupon, duplicateCoupon, toggleCoupon } from "./actions";
import { CopyValueButton } from "@/components/admin/copy-value-button";
import { DeleteButton } from "@/components/admin/form-bits";
import { DataTable, EmptyState, PageHeader, Section, StatCard, ToneBadge } from "@/components/admin/ui";
import { Button, LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Coupons" };

const STATUS_TONES: Record<CouponStatus, "neutral" | "emerald" | "amber" | "red" | "blue" | "brand"> = {
  active: "emerald",
  scheduled: "blue",
  expired: "neutral",
  exhausted: "amber",
  disabled: "neutral",
};

function scopeLabel(coupon: Coupon): string {
  if (coupon.scope_type === "all") return "Whole order";
  const n = coupon.scope_ids.length;
  return coupon.scope_type === "categories" ? `${n} categor${n === 1 ? "y" : "ies"}` : `${n} product${n === 1 ? "" : "s"}`;
}

function scheduleLabel(coupon: Coupon): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  if (coupon.starts_at && coupon.expires_at) return `${fmt(coupon.starts_at)} → ${fmt(coupon.expires_at)}`;
  if (coupon.expires_at) return `Ends ${fmt(coupon.expires_at)}`;
  if (coupon.starts_at) return `From ${fmt(coupon.starts_at)}`;
  return "No expiry";
}

export default async function AdminCouponsPage() {
  const [coupons, money] = await Promise.all([adminListCoupons(), getMoney()]);
  const active = coupons.filter((c) => couponStatus(c) === "active").length;
  const redemptions = coupons.reduce((sum, c) => sum + c.times_redeemed, 0);
  const savings = coupons.reduce((sum, c) => sum + (c.total_discount_micros ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Promo codes customers can apply in the cart or at checkout. Discounts are always re-validated by the database when an order is placed."
        actions={
          <LinkButton href="/nemesis/coupons/new">
            <PlusIcon /> New coupon
          </LinkButton>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active coupons" value={active} hint={`${coupons.length} total`} icon={<TicketPercentIcon />} />
        <StatCard label="Redemptions" value={redemptions} hint="Orders placed with a coupon" icon={<CopyPlusIcon />} />
        <StatCard label="Customer savings" value={formatMoney(savings, money)} hint="Discounts given so far" icon={<TicketPercentIcon />} />
      </div>

      {coupons.length === 0 ? (
        <EmptyState title="No coupons yet" icon={<TicketPercentIcon />}>
          Create your first promo code — a welcome offer like <span className="font-mono font-semibold">WELCOME10</span> is a great start.
          If this store was set up before coupons arrived, run{" "}
          <span className="font-mono text-xs">supabase/migrations/20261061000000_coupons_reviews.sql</span> first.
        </EmptyState>
      ) : (
        <DataTable
          label="Coupons"
          columns={[
            { id: "code", label: "Code", className: "pl-4" },
            { id: "discount", label: "Discount" },
            { id: "scope", label: "Applies to", cellClassName: "text-muted-foreground" },
            { id: "usage", label: "Usage" },
            { id: "schedule", label: "Schedule", cellClassName: "text-muted-foreground" },
            { id: "status", label: "Status" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          rows={coupons.map((coupon) => {
            const status = couponStatus(coupon);
            const usagePct = couponUsagePercent(coupon);
            return {
              id: coupon.id,
              label: coupon.code,
              cells: [
                <span key="code" className="flex items-center gap-2">
                  <Link href={`/nemesis/coupons/${coupon.id}`} className="rounded-md border border-dashed bg-muted/60 px-2 py-1 font-mono text-sm font-bold tracking-wide hover:border-primary hover:text-primary">
                    {coupon.code}
                  </Link>
                  <CopyValueButton value={coupon.code} label="Copy code" />
                </span>,
                <span key="discount" className="font-medium whitespace-nowrap">
                  {describeCoupon(coupon, money)}
                  {coupon.first_order_only ? <span className="block text-xs font-normal text-muted-foreground">First order only</span> : null}
                </span>,
                scopeLabel(coupon),
                <span key="usage" className="block min-w-24">
                  <span className="tabular-nums">
                    {coupon.times_redeemed}
                    {coupon.usage_limit != null ? ` / ${coupon.usage_limit}` : ""}
                  </span>
                  {coupon.usage_limit != null ? (
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${usagePct}%` }} />
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">Unlimited</span>
                  )}
                  {coupon.total_discount_micros ? (
                    <span className="block text-xs text-muted-foreground">{formatMoney(coupon.total_discount_micros, money)} saved</span>
                  ) : null}
                </span>,
                scheduleLabel(coupon),
                <ToneBadge key="status" tone={STATUS_TONES[status]}>
                  {COUPON_STATUS_LABELS[status]}
                </ToneBadge>,
                <div key="actions" className="flex items-center justify-end gap-1.5">
                  <form action={toggleCoupon}>
                    <input type="hidden" name="id" value={coupon.id} />
                    <Button type="submit" variant="ghost" size="icon-sm" aria-label={coupon.is_active ? `Pause ${coupon.code}` : `Activate ${coupon.code}`}>
                      {coupon.is_active ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                  </form>
                  <form action={duplicateCoupon}>
                    <input type="hidden" name="id" value={coupon.id} />
                    <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Duplicate ${coupon.code}`}>
                      <CopyPlusIcon />
                    </Button>
                  </form>
                  <LinkButton href={`/nemesis/coupons/${coupon.id}`} variant="ghost" size="icon-sm" aria-label={`Edit ${coupon.code}`}>
                    <SquarePenIcon />
                  </LinkButton>
                  <DeleteButton
                    action={deleteCoupon}
                    id={coupon.id}
                    label={`Delete ${coupon.code}`}
                    title={`Delete coupon ${coupon.code}?`}
                    description="Customers will no longer be able to use this code. Orders already placed with it keep their discount."
                  />
                </div>,
              ],
            };
          })}
        />
      )}

      <Section title="How coupons behave" className="mt-6">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>One coupon per order. The discount is recomputed inside the database at checkout, so a code can never be over-applied from the browser.</li>
          <li>Usage is counted when the order is placed and given back automatically if that order is cancelled.</li>
          <li>Category/product coupons only discount matching items — the minimum spend applies to those items too.</li>
          <li>Pausing keeps the code and its history; deleting only stops future use.</li>
        </ul>
      </Section>
    </>
  );
}
