import type { Metadata } from "next";
import Link from "next/link";
import { PackageIcon, PlusIcon } from "lucide-react";
import { adminListCategories, adminListProducts } from "@/lib/admin/data";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatMoney, moneyFromSettings } from "@/lib/money";
import { deleteProduct, deleteProducts, toggleProductFeatured } from "@/app/nemesis/actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { FilterSelect } from "@/components/admin/filter-select";
import { DeleteButton, FeaturedToggleButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader, Thumb, ToneBadge } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Products" };

const LIST_PATH = "/nemesis/products";

type SearchParams = Promise<{ q?: string; category?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = { q: sp.q?.trim() || undefined, category: sp.category || undefined };
  const { perPage, requestedPage } = await resolveListParams(sp);
  const [{ items: products, total, page }, categories, settings] = await Promise.all([
    adminListProducts({ ...filters, page: requestedPage, perPage }),
    adminListCategories(),
    getSiteSettingsFresh(),
  ]);
  const manageStock = settings.manage_stock;
  const money = moneyFromSettings(settings);
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);

  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q || filters.category);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const editHref = (id: string) => `/nemesis/products/${id}?from=${encodeURIComponent(listUrl)}`;

  return (
    <>
      <PageHeader
        title="Products"
        description={`${total} ${total === 1 ? "product" : "products"}${isFiltered ? " match your filter" : ""}.`}
        actions={
          <Link href="/nemesis/products/new" className={buttonVariants()}>
            <PlusIcon /> New product
          </Link>
        }
      />

      <ListToolbar {...location}>
        <SearchForm action={LIST_PATH} q={filters.q} placeholder="Search name or slug…" isFiltered={isFiltered} hidden={{ per: perPage }} clearHref={listHref(LIST_PATH, { per: perPage })}>
          <FilterSelect
            name="category"
            label="Category"
            defaultValue={filters.category ?? ""}
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </SearchForm>
      </ListToolbar>

      {products.length === 0 ? (
        <EmptyState title={isFiltered ? "No products match your filter." : "No products yet."} icon={<PackageIcon />}>
          {isFiltered ? (
            "Try a different search or clear the filter."
          ) : (
            <>
              <Link href="/nemesis/products/new" className="text-primary hover:underline">
                Create the first one
              </Link>
              .
            </>
          )}
        </EmptyState>
      ) : (
        <DataTable
          label="Products"
          columns={[
            { id: "product", label: "Product", className: "pl-4" },
            { id: "category", label: "Category", cellClassName: "text-muted-foreground" },
            { id: "price", label: "Price", align: "right", cellClassName: "tabular-nums" },
            // Settings → WooCommerce → stock management off hides the stock column everywhere
            ...(manageStock ? [{ id: "stock", label: "Stock", align: "right" as const, cellClassName: "tabular-nums" }] : []),
            { id: "status", label: "Status" },
            { id: "featured", label: "Featured" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          bulkDelete={{
            action: deleteProducts,
            returnTo: listUrl,
            noun: ["product", "products"],
            description: "The selected products are removed permanently. Orders that contain them keep their line items. This cannot be undone.",
          }}
          rows={products.map((p) => ({
            id: p.id,
            href: editHref(p.id),
            cells: [
              <div key="p" className="flex items-center gap-3">
                <Thumb src={p.image_url} />
                <div className="min-w-0">
                  <span className="flex items-center gap-2">
                    <Link href={editHref(p.id)} className="truncate font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.type === "variable" && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        Variable
                      </Badge>
                    )}
                  </span>
                  <p className="truncate text-xs text-muted-foreground">/{p.slug}</p>
                </div>
              </div>,
              p.category?.name ?? "—",
              <span key="price">
                {p.type === "variable" && <span className="mr-1 text-xs text-muted-foreground">From</span>}
                {formatMoney(p.price_micros, money)}
                {p.compare_at_price_micros != null && p.compare_at_price_micros > p.price_micros && (
                  <span className="ml-1 text-xs text-muted-foreground line-through">{formatMoney(p.compare_at_price_micros, money)}</span>
                )}
              </span>,
              ...(manageStock
                ? [
                    <span key="stock" className={p.stock === 0 ? "font-semibold text-destructive" : p.stock <= 5 ? "font-semibold text-amber-600 dark:text-amber-400" : undefined}>
                      {p.stock}
                    </span>,
                  ]
                : []),
              <div key="status" className="flex flex-wrap gap-1">
                <ToneBadge tone={p.is_active ? "emerald" : "neutral"}>{p.is_active ? "Active" : "Draft"}</ToneBadge>
              </div>,
              <FeaturedToggleButton key="featured" id={p.id} name={p.name} initialFeatured={p.is_featured} action={toggleProductFeatured} />,
              <div key="actions" className="flex items-center justify-end gap-2">
                <Link href={editHref(p.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Edit
                </Link>
                <DeleteButton action={deleteProduct} id={p.id} returnTo={listUrl} title={`Delete "${p.name}"?`} description="The product is removed permanently. This cannot be undone." />
              </div>,
            ],
          }))}
        />
      )}

      <Pagination {...location} total={total} itemLabel={total === 1 ? "product" : "products"} />
    </>
  );
}
