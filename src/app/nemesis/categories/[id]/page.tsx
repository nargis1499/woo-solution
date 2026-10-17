import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetCategory } from "@/lib/admin/data";
import { deleteCategory } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import type { Category } from "@/lib/types";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader, Section } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Edit category" };

/**
 * Everything the form draws, as one key.
 *
 * The router keeps visited pages mounted, so without a key the form would come
 * back with the state it was left in (the icon the admin just removed, an old
 * slug …) instead of the row that was saved. A changed key remounts it against
 * the fresh row.
 */
function formKey(category: Category): string {
  return [
    category.id,
    category.name,
    category.slug,
    category.icon ?? "",
    category.icon_color ?? "",
    category.icon_disabled ? "1" : "0",
    category.image_url ?? "",
    category.image_media_id ?? "",
  ].join(":");
}

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
        actions={<DeleteButton action={deleteCategory} id={category.id} returnTo="/nemesis/categories" label="Delete category" size="default" title={`Delete "${category.name}"?`} description="Its products will become uncategorised." />}
      />
      <Section className="max-w-xl">
        <CategoryForm key={formKey(category)} category={category} />
      </Section>
    </>
  );
}
