import type { Metadata } from "next";
import Link from "next/link";
import { adminListCategories, adminListProducts } from "@/lib/admin/data";
import { formatPrice } from "@/lib/format";
import { deleteProduct } from "@/app/nemesis/actions";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { Badge, EmptyRow, PageHeader, TBody, THead, Table, Td, Th, Thumb, Tr } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Products" };

type SearchParams = Promise<{ q?: string; category?: string }>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, category } = await searchParams;
  const [products, categories] = await Promise.all([adminListProducts({ q, category }), adminListCategories()]);

  return (
    <>
      <PageHeader
        title="Products"
        description={`${products.length} ${products.length === 1 ? "product" : "products"}${q || category ? " match your filter" : ""}.`}
        actions={<ButtonLink href="/nemesis/products/new">+ New product</ButtonLink>}
      />

      <div className="mb-4">
        <SearchForm action="/nemesis/products" q={q} placeholder="Search name or slug…" isFiltered={Boolean(q || category)}>
          <select name="category" defaultValue={category ?? ""} className="input-base w-auto" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </SearchForm>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Product</Th>
            <Th>Category</Th>
            <Th className="text-right">Price</Th>
            <Th className="text-right">Stock</Th>
            <Th>Status</Th>
            <Th className="text-right"><span className="sr-only">Actions</span></Th>
          </tr>
        </THead>
        <TBody>
          {products.length === 0 && (
            <EmptyRow colSpan={6}>
              {q || category ? "No products match your filter." : (
                <>No products yet. <Link href="/nemesis/products/new" className="text-brand-700 dark:text-brand-300 hover:underline">Create the first one</Link>.</>
              )}
            </EmptyRow>
          )}
          {products.map((p) => (
            <Tr key={p.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <Thumb src={p.image_url} />
                  <div className="min-w-0">
                    <Link href={`/nemesis/products/${p.id}`} className="block truncate font-medium hover:underline">{p.name}</Link>
                    <p className="truncate text-xs text-neutral-500">/{p.slug}</p>
                  </div>
                </div>
              </Td>
              <Td className="text-neutral-600">{p.category?.name ?? <span className="text-neutral-400">—</span>}</Td>
              <Td className="text-right tabular-nums">
                {formatPrice(p.price_cents)}
                {p.compare_at_price_cents != null && p.compare_at_price_cents > p.price_cents && (
                  <span className="ml-1 text-xs text-neutral-400 line-through">{formatPrice(p.compare_at_price_cents)}</span>
                )}
              </Td>
              <Td className="text-right tabular-nums">
                <span className={p.stock === 0 ? "font-semibold text-red-600" : p.stock <= 5 ? "font-semibold text-amber-600" : ""}>{p.stock}</span>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={p.is_active ? "emerald" : "neutral"}>{p.is_active ? "Active" : "Draft"}</Badge>
                  {p.is_featured && <Badge tone="brand">Featured</Badge>}
                </div>
              </Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/nemesis/products/${p.id}`} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100">Edit</Link>
                  <ConfirmForm action={deleteProduct} message={`Delete "${p.name}"? This cannot be undone.`}>
                    <input type="hidden" name="id" value={p.id} />
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
