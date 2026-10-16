import type { Metadata } from "next";
import { adminListCategories } from "@/lib/admin/data";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const [categories, { manage_stock }] = await Promise.all([adminListCategories(), getSiteSettingsFresh()]);
  return (
    <>
      <PageHeader title="New product" description="Add a product to the catalog." backHref="/nemesis/products" backLabel="Products" />
      <ProductForm categories={categories} manageStock={manage_stock} />
    </>
  );
}
