import type { Metadata } from "next";
import Link from "next/link";
import { adminListCategories } from "@/lib/admin/data";
import { deleteCategory, reorderCategories } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { DataTable, EmptyState, PageHeader, Section } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const categories = await adminListCategories();

  return (
    <>
      <PageHeader
        title="Categories"
      />

      <Section title="Add a category" className="mb-6">
        <CategoryForm compact />
      </Section>

      {categories.length === 0 ? (
        <EmptyState title="No categories yet">Add one above.</EmptyState>
      ) : (
        <DataTable
          label="Categories"
          columns={[
            { id: "name", label: "Name", className: "pl-4" },
            { id: "slug", label: "Slug", cellClassName: "text-muted-foreground" },
            { id: "products", label: "Products", align: "right", cellClassName: "tabular-nums" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          reorder={{ action: reorderCategories, savedMessage: "Category order saved." }}
          rows={categories.map((c) => ({
            id: c.id,
            label: c.name,
            cells: [
              <Link key="n" href={`/nemesis/categories/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>,
              <Link key="s" href={`/shop?category=${c.slug}`} target="_blank" className="hover:underline">
                /shop?category={c.slug}
              </Link>,
              <Link key="p" href={`/nemesis/products?category=${c.id}`} className="hover:underline">
                {c.product_count ?? 0}
              </Link>,
              <div key="a" className="flex items-center justify-end gap-2">
                <Link href={`/nemesis/categories/${c.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Edit
                </Link>
                <DeleteButton
                  action={deleteCategory}
                  id={c.id}
                  title={`Delete "${c.name}"?`}
                  description={c.product_count ? `${c.product_count} product(s) will become uncategorised.` : "This cannot be undone."}
                />
              </div>,
            ],
          }))}
        />
      )}
    </>
  );
}
