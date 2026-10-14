import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetProduct, adminListCategories } from "@/lib/admin/data";
import { formatDate } from "@/lib/format";
import { deleteProduct } from "@/app/nemesis/actions";
import { ProductForm } from "@/components/admin/product-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories] = await Promise.all([adminGetProduct(id), adminListCategories()]);
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={product.name}
        description={`Last updated ${formatDate(product.updated_at ?? product.created_at)}`}
        backHref="/nemesis/products"
        backLabel="Products"
        actions={
          <ConfirmForm action={deleteProduct} message={`Delete "${product.name}"? This cannot be undone.`}>
            <input type="hidden" name="id" value={product.id} />
            <DeleteButton label="Delete product" size="md" />
          </ConfirmForm>
        }
      />
      <ProductForm product={product} categories={categories} />
    </>
  );
}
