import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetProduct, adminListCategories } from "@/lib/admin/data";
import { getSiteSettings } from "@/lib/site-settings";
import { formatDate } from "@/lib/format";
import { deleteProduct } from "@/app/nemesis/actions";
import { ProductForm } from "@/components/admin/product-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader } from "@/components/admin/ui";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back / Cancel / after-save all return to the exact list page the admin came from.
  const backHref = safeListReturn(from, "/nemesis/products") ?? "/nemesis/products";
  const [product, categories, { manage_stock }] = await Promise.all([adminGetProduct(id), adminListCategories(), getSiteSettings()]);
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={product.name}
        description={`Last updated ${formatDate(product.updated_at ?? product.created_at)}`}
        backHref={backHref}
        backLabel="Products"
        actions={
          <DeleteButton action={deleteProduct} id={product.id} returnTo={backHref} label="Delete product" size="default" title={`Delete "${product.name}"?`} description="The product is removed permanently. This cannot be undone." />
        }
      />
      <ProductForm product={product} categories={categories} returnTo={backHref} manageStock={manage_stock} />
    </>
  );
}
