import type { Metadata } from "next";
import Link from "next/link";
import { adminListCategories } from "@/lib/admin/data";
import { deleteCategory } from "@/app/nemesis/actions";
import { CategoryForm } from "@/components/admin/category-form";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { EmptyRow, Flash, PageHeader, Section, Table, TBody, Td, Th, THead, Tr } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Categories" };

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function AdminCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ notice, error }, categories] = await Promise.all([searchParams, adminListCategories()]);

  return (
    <>
      <PageHeader title="Categories" description="Group products so customers can browse by type. Order controls the navigation." />
      <Flash notice={notice} error={error} />

      <Section title="Add a category" className="mb-6">
        <CategoryForm compact />
      </Section>

      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Slug</Th>
            <Th className="text-right">Products</Th>
            <Th className="text-right">Order</Th>
            <Th className="text-right"><span className="sr-only">Actions</span></Th>
          </tr>
        </THead>
        <TBody>
          {categories.length === 0 && <EmptyRow colSpan={5}>No categories yet – add one above.</EmptyRow>}
          {categories.map((c) => (
            <Tr key={c.id}>
              <Td>
                <Link href={`/nemesis/categories/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
              </Td>
              <Td className="text-neutral-600">
                <Link href={`/shop?category=${c.slug}`} target="_blank" className="hover:underline">/shop?category={c.slug}</Link>
              </Td>
              <Td className="text-right tabular-nums">
                <Link href={`/nemesis/products?category=${c.id}`} className="hover:underline">{c.product_count ?? 0}</Link>
              </Td>
              <Td className="text-right tabular-nums text-neutral-600">{c.sort_order}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/nemesis/categories/${c.id}`} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100">Edit</Link>
                  <ConfirmForm
                    action={deleteCategory}
                    message={`Delete "${c.name}"? ${c.product_count ? `${c.product_count} product(s) will become uncategorised.` : ""}`}
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <DeleteButton />
                  </ConfirmForm>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </>
  );
}
