import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetCategory } from "@/lib/admin/data";
import { deleteCategory } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader, Section } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Edit category" };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = await adminGetCategory(id);
  if (!category) notFound();

  return (
    <>
      <PageHeader
        title={category.name}
        description={`${category.product_count ?? 0} product(s) in this category`}
        backHref="/nemesis/categories"
        backLabel="Categories"
        actions={<DeleteButton action={deleteCategory} id={category.id} label="Delete category" size="default" title={`Delete "${category.name}"?`} description="Its products will become uncategorised." />}
      />
      <Section className="max-w-xl">
        <CategoryForm category={category} />
      </Section>
    </>
  );
}
