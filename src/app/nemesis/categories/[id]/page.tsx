import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetCategory } from "@/lib/admin/data";
import { deleteCategory } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
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
        actions={
          <ConfirmForm action={deleteCategory} message={`Delete "${category.name}"? Its products will become uncategorised.`}>
            <input type="hidden" name="id" value={category.id} />
            <DeleteButton label="Delete category" size="md" />
          </ConfirmForm>
        }
      />
      <Section className="max-w-xl">
        <CategoryForm category={category} />
      </Section>
    </>
  );
}
