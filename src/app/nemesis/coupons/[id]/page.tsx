import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetCoupon, adminListCategories, adminListSimpleProducts } from "@/lib/admin/data";
import { getMoney } from "@/lib/site-settings";
import type { Coupon } from "@/lib/types";
import { deleteCoupon } from "../actions";
import { CouponForm } from "@/components/admin/coupons/coupon-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader, Section } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Edit coupon" };

/** Remount the form whenever the saved row changes (same pattern as categories). */
function formKey(coupon: Coupon): string {
  return [
    coupon.id,
    coupon.code,
    coupon.discount_type,
    String(coupon.percent_off ?? ""),
    String(coupon.amount_off_micros ?? ""),
    String(coupon.min_subtotal_micros),
    coupon.scope_type,
    coupon.scope_ids.join(","),
    coupon.is_active ? "1" : "0",
    coupon.updated_at,
  ].join(":");
}

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [coupon, money, categories, products] = await Promise.all([
    adminGetCoupon(id),
    getMoney(),
    adminListCategories(),
    adminListSimpleProducts(),
  ]);
  if (!coupon) notFound();

  return (
    <>
      <PageHeader
        title={coupon.code}
        description={`Redeemed ${coupon.times_redeemed} time${coupon.times_redeemed === 1 ? "" : "s"}.`}
        backHref="/nemesis/coupons"
        backLabel="Coupons"
        actions={
          <DeleteButton
            action={deleteCoupon}
            id={coupon.id}
            returnTo="/nemesis/coupons"
            label="Delete coupon"
            size="default"
            title={`Delete coupon ${coupon.code}?`}
            description="Customers will no longer be able to use this code. Orders already placed with it keep their discount."
          />
        }
      />
      <Section className="max-w-3xl">
        <CouponForm key={formKey(coupon)} coupon={coupon} money={money} categories={categories} products={products} />
      </Section>
    </>
  );
}
