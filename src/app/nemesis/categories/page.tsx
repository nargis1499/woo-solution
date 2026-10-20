import type { Metadata } from "next";
import Link from "next/link";
import { EyeIcon, SquarePenIcon, TagsIcon } from "lucide-react";
import { adminListCategoriesPage } from "@/lib/admin/data";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { deleteAllCategories, deleteCategories, deleteCategory, reorderCategories } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import { CategoryThumb } from "@/components/category-thumb";
import { DeleteAllButton, DeleteButton, OpenTabButton } from "@/components/admin/form-bits";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader, Section } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";

export const metadata: Metadata = { title: "Categories" };

const LIST_PATH = "/nemesis/categories";

type SearchParams = Promise<{ page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { perPage, requestedPage } = await resolveListParams(sp);
  const { items: categories, total, page } = await adminListCategoriesPage({ page: requestedPage, perPage });
  redirectIfClamped(LIST_PATH, {}, sp, requestedPage, page, perPage);
  const listUrl = listHref(LIST_PATH, { per: perPage, page });
  const location = { pathname: LIST_PATH, params: {}, page, perPage };

  return (
    <>
      <PageHeader
        title="Categories"
        description={`${total} ${total === 1 ? "category" : "categories"}.`}
        actions={
          <DeleteAllButton
            action={deleteAllCategories}
            returnTo={listUrl}
            label="Delete all"
            title="Delete every category?"
            description={`All ${total} categories are removed permanently and their products become uncategorised. This cannot be undone.`}
            count={total}
          />
        }
      />

      <Section title="Add a category" className="mb-6">
        <CategoryForm compact />
      </Section>

      {total === 0 ? (
        <EmptyState title="No categories yet" icon={<TagsIcon />}>
          Add one above.
        </EmptyState>
      ) : (
        <>
          <ListToolbar {...location}>{null}</ListToolbar>
          <DataTable
            label="Categories"
            columns={[
              { id: "name", label: "Name", className: "pl-4" },
              { id: "slug", label: "Slug", cellClassName: "text-muted-foreground" },
              { id: "products", label: "Products", align: "right", cellClassName: "tabular-nums" },
              { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
            ]}
            bulkDelete={{
              action: deleteCategories,
              returnTo: listUrl,
              noun: ["category", "categories"],
              description: "The selected categories are removed permanently and their products become uncategorised. This cannot be undone.",
            }}
            reorder={{ action: reorderCategories, savedMessage: "Category order saved." }}
            rows={categories.map((c) => ({
              id: c.id,
              label: c.name,
              cells: [
                <Link key="n" href={`/nemesis/categories/${c.id}`} className="flex items-center gap-3 font-medium hover:underline">
                  <CategoryThumb category={c} size="sm" />
                  {c.name}
                </Link>,
                <Link key="s" href={`/shop?category=${c.slug}`} target="_blank" className="hover:underline">
                  /shop?category={c.slug}
                </Link>,
                <Link key="p" href={`/nemesis/products?category=${c.id}`} className="hover:underline">
                  {c.product_count ?? 0}
                </Link>,
                <div key="a" className="flex items-center justify-end gap-1.5">
                  <OpenTabButton href={`/shop?category=${c.slug}`} ariaLabel={`View "${c.name}" in the store`}>
                    <EyeIcon className="size-4" />
                  </OpenTabButton>
                  <Link
                    href={`/nemesis/categories/${c.id}`}
                    aria-label={`Edit "${c.name}"`}
                    title={`Edit "${c.name}"`}
                    className={buttonVariants({ variant: "outline", size: "icon-sm" })}
                  >
                    <SquarePenIcon className="size-4" />
                  </Link>
                  <DeleteButton
                    action={deleteCategory}
                    id={c.id}
                    returnTo={listUrl}
                    title={`Delete "${c.name}"?`}
                    description={c.product_count ? `${c.product_count} product(s) will become uncategorised.` : "This cannot be undone."}
                  />
                </div>,
              ],
            }))}
          />
          <Pagination {...location} total={total} itemLabel={total === 1 ? "category" : "categories"} />
        </>
      )}
    </>
  );
}
