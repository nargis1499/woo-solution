import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminListCategories, adminListProducts } from "@/lib/admin/data";
import { PER_PAGE_COOKIE, listHref, pageCount, parsePage, parsePerPage } from "@/lib/admin/pagination";
import { formatPrice } from "@/lib/format";
import { deleteProduct } from "@/app/nemesis/actions";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmForm, DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { Pagination } from "@/components/admin/pagination";
import { Badge, EmptyRow, PageHeader, TBody, THead, Table, Td, Th, Thumb, Tr } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Products" };

const LIST_PATH = "/nemesis/products";

type SearchParams = Promise<{ q?: string; category?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const category = sp.category || undefined;
  const filters = { q, category };

  // page size: ?per= → remembered preference → 10
  const cookieStore = await cookies();
  const perPage = parsePerPage(sp.per, parsePerPage(cookieStore.get(PER_PAGE_COOKIE)?.value));
  const requestedPage = parsePage(sp.page);

  const [{ items: products, total }, categories] = await Promise.all([
    adminListProducts({ ...filters, page: requestedPage, perPage }),
    adminListCategories(),
  ]);

  // Keep the URL honest: a page that no longer exists (after deletes or a size
  // change) redirects to the last valid page – any pending toast comes along.
  const pages = pageCount(total, perPage);
  if (requestedPage > pages) {
    const flash = sp.notice ? { notice: sp.notice } : sp.error ? { error: sp.error } : {};
    redirect(listHref(LIST_PATH, { ...filters, ...flash, per: perPage, page: pages }));
  }
  const page = requestedPage;
  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(q || category);

  return (
    <>
      <PageHeader
        title="Products"
        description={`${total} ${total === 1 ? "product" : "products"}${isFiltered ? " match your filter" : ""}.`}
        actions={<ButtonLink href="/nemesis/products/new">+ New product</ButtonLink>}
      />

      <div className="mb-4">
        <SearchForm
          action={LIST_PATH}
          q={q}
          placeholder="Search name or slug…"
          isFiltered={isFiltered}
          hidden={{ per: perPage }}
          clearHref={listHref(LIST_PATH, { per: perPage })}
        >
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
              {isFiltered ? "No products match your filter." : (
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
                    <Link href={`/nemesis/products/${p.id}?from=${encodeURIComponent(listUrl)}`} className="block truncate font-medium hover:underline">{p.name}</Link>
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
                  <Link href={`/nemesis/products/${p.id}?from=${encodeURIComponent(listUrl)}`} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100">Edit</Link>
                  <ConfirmForm action={deleteProduct} message={`Delete "${p.name}"? This cannot be undone.`}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="return_to" value={listUrl} />
                    <DeleteButton />
                  </ConfirmForm>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <Pagination pathname={LIST_PATH} params={filters} page={page} perPage={perPage} total={total} itemLabel={total === 1 ? "product" : "products"} />
    </>
  );
}
