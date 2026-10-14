import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetProduct, adminListCategories } from "@/lib/admin/data";
import { formatDate } from "@/lib/format";
import { deleteProduct } from "@/app/nemesis/actions";
import { ProductForm } from "@/components/admin/product-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { PageHeader } from "@/components/admin/ui";
import { safeListReturn } from "@/lib/admin/pagination";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back / Cancel / after-save all return to the exact list page the admin came from.
  const backHref = safeListReturn(from, "/nemesis/products") ?? "/nemesis/products";
  const [product, categories] = await Promise.all([adminGetProduct(id), adminListCategories()]);
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={product.name}
        description={`Last updated ${formatDate(product.updated_at ?? product.created_at)}`}
        backHref={backHref}
        backLabel="Products"
        actions={
          <ConfirmForm action={deleteProduct} message={`Delete "${product.name}"? This cannot be undone.`}>
            <input type="hidden" name="id" value={product.id} />
            <input type="hidden" name="return_to" value={backHref} />
            <DeleteButton label="Delete product" size="md" />
          </ConfirmForm>
        }
      />
      <ProductForm product={product} categories={categories} returnTo={backHref} />
    </>
  );
}
