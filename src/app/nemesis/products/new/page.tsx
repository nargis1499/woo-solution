import type { Metadata } from "next";
import { adminListCategories } from "@/lib/admin/data";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const categories = await adminListCategories();
  return (
    <>
      <PageHeader title="New product" description="Add a product to the catalog." backHref="/nemesis/products" backLabel="Products" />
      <ProductForm categories={categories} />
    </>
  );
}
