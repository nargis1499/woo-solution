import type { Metadata } from "next";
import { adminListCategories, adminListSimpleProducts } from "@/lib/admin/data";
import { getMoney } from "@/lib/site-settings";
import { CouponForm } from "@/components/admin/coupons/coupon-form";
import { PageHeader, Section } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New coupon" };

export default async function NewCouponPage() {
  const [money, categories, products] = await Promise.all([getMoney(), adminListCategories(), adminListSimpleProducts()]);
  return (
    <>
      <PageHeader title="New coupon" description="Create a promo code for the cart and checkout." backHref="/nemesis/coupons" backLabel="Coupons" />
      <Section className="max-w-3xl">
        <CouponForm money={money} categories={categories} products={products} />
      </Section>
    </>
  );
}
