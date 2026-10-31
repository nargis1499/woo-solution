import type { Metadata } from "next";
import { adminListCategories, adminListSimpleProducts } from "@/lib/admin/data";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const [categories, settings, simpleProducts] = await Promise.all([adminListCategories(), getSiteSettingsFresh(), adminListSimpleProducts()]);
  return (
    <>
      <PageHeader title="New product" description="Add a product to the catalog." backHref="/nemesis/products" backLabel="Products" />
      <ProductForm categories={categories} manageStock={settings.manage_stock} siteUrl={settings.seo_site_url} storeName={settings.store_name} simpleProducts={simpleProducts} />
    </>
  );
}
