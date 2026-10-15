import type { Metadata } from "next";
import Link from "next/link";
import { EyeIcon, FileTextIcon, GlobeIcon, PencilLineIcon, PlusIcon } from "lucide-react";
import { adminListPages } from "@/lib/admin/data";
import { listHref } from "@/lib/admin/pagination";
import { redirectIfClamped, resolveListParams } from "@/lib/admin/list-params";
import { formatDate } from "@/lib/format";
import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import { PAGE_SORTS, PAGE_STATUSES, pageHref, pagePreviewHref, parsePageSort, parsePageStatus } from "@/lib/pages/shared";
import { deletePage, deletePages, publishPages, unpublishPages } from "@/app/nemesis/pages/actions";
import { buttonVariants } from "@/components/ui/button-variants";
import { Badge } from "@/components/ui/badge";
import { FilterSelect } from "@/components/admin/filter-select";
import { DeleteButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader, Thumb } from "@/components/admin/ui";
import { PageStatusSelect } from "@/components/admin/pages/page-status-select";

export const metadata: Metadata = { title: "Pages" };

const LIST_PATH = "/nemesis/pages";

type SearchParams = Promise<{ q?: string; status?: string; sort?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminPagesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = parsePageStatus(sp.status);
  const sort = parsePageSort(sp.sort);
  const filters = { q: sp.q?.trim() || undefined, status: status || undefined, sort: sort === "updated_desc" ? undefined : sort };
  const { perPage, requestedPage } = await resolveListParams(sp);
  const { items: pages, total, page } = await adminListPages({ q: filters.q, status, sort, page: requestedPage, perPage });
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);

  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q || filters.status);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const editHref = (id: string) => `${LIST_PATH}/${id}?from=${encodeURIComponent(listUrl)}`;

  return (
    <>
      <PageHeader
        title="Pages"
        description={`${total} ${total === 1 ? "page" : "pages"}${isFiltered ? " match your filter" : ""}. About, Contact, Privacy policy, FAQ – anything that is not a product.`}
        actions={
          <Link href={`${LIST_PATH}/new`} className={buttonVariants()}>
            <PlusIcon /> New page
          </Link>
        }
      />

      <ListToolbar {...location}>
        <SearchForm action={LIST_PATH} q={filters.q} placeholder="Search title or slug…" isFiltered={isFiltered || Boolean(filters.sort)} hidden={{ per: perPage }} clearHref={listHref(LIST_PATH, { per: perPage })}>
          <FilterSelect name="status" label="Status" defaultValue={status} options={[{ value: "", label: "All statuses" }, ...PAGE_STATUSES.map((s) => ({ value: s.id, label: s.label }))]} />
          <FilterSelect name="sort" label="Sort" defaultValue={sort} options={PAGE_SORTS.map((s) => ({ value: s.id, label: s.label }))} className="min-w-44" />
        </SearchForm>
      </ListToolbar>

      {pages.length === 0 ? (
        <EmptyState title={isFiltered ? "No pages match your filter." : "No pages yet."} icon={<FileTextIcon />}>
          {isFiltered ? (
            "Try a different search or clear the filter."
          ) : (
            <>
              <Link href={`${LIST_PATH}/new`} className="text-primary hover:underline">
                Create the first one
              </Link>{" "}
              – an About page, a Contact page or your Privacy policy.
            </>
          )}
        </EmptyState>
      ) : (
        <DataTable
          label="Pages"
          tableClassName="min-w-[860px]"
          columns={[
            { id: "page", label: "Page", className: "pl-4" },
            { id: "status", label: "Status" },
            { id: "author", label: "Author", cellClassName: "text-muted-foreground" },
            { id: "updated", label: "Updated", cellClassName: "text-muted-foreground whitespace-nowrap" },
            { id: "published", label: "Published", cellClassName: "text-muted-foreground whitespace-nowrap" },
            { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" },
          ]}
          bulkDelete={{
            action: deletePages,
            returnTo: listUrl,
            noun: ["page", "pages"],
            description: "The selected pages are removed permanently and their public URLs stop working. Media Library files stay in the library. This cannot be undone.",
            extra: [
              { id: "publish", label: "Publish", icon: <GlobeIcon />, action: publishPages },
              { id: "unpublish", label: "Move to drafts", icon: <PencilLineIcon />, action: unpublishPages },
            ],
          }}
          rows={pages.map((p) => {
            const image = p.featured_image && !p.featured_image.deleted_at ? p.featured_image : null;
            const thumb = image ? (mediaPreviewUrl(image, "thumbnail") ?? mediaUrl(image.path)) : null;
            return {
              id: p.id,
              href: editHref(p.id),
              cells: [
                <div key="p" className="flex items-center gap-3">
                  <Thumb src={thumb} />
                  <div className="min-w-0">
                    <Link href={editHref(p.id)} className="block truncate font-medium hover:underline" data-testid="page-title">
                      {p.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {pageHref(p.slug)}
                      {p.tags && p.tags.length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {p.tags.slice(0, 3).map((t) => (
                            <Badge key={t.id} variant="outline" className="h-4 px-1 text-[10px] font-normal">
                              {t.name}
                            </Badge>
                          ))}
                          {p.tags.length > 3 && <span>+{p.tags.length - 3}</span>}
                        </span>
                      )}
                    </p>
                  </div>
                </div>,
                <PageStatusSelect key="status" id={p.id} status={p.status} title={p.title} returnTo={listUrl} />,
                p.author?.full_name || p.author?.email || "—",
                formatDate(p.updated_at),
                p.status === "published" && p.published_at ? formatDate(p.published_at) : "—",
                <div key="actions" className="flex items-center justify-end gap-2">
                  {p.status === "published" ? (
                    <a href={pageHref(p.slug)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`View "${p.title}" in the store`}>
                      <EyeIcon /> View
                    </a>
                  ) : (
                    <a href={pagePreviewHref(p.id)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Preview "${p.title}"`}>
                      <EyeIcon /> Preview
                    </a>
                  )}
                  <Link href={editHref(p.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Edit
                  </Link>
                  <DeleteButton action={deletePage} id={p.id} returnTo={listUrl} title={`Delete "${p.title}"?`} description={`The page and its public URL ${pageHref(p.slug)} are removed permanently. This cannot be undone.`} />
                </div>,
              ],
            };
          })}
        />
      )}

      <Pagination {...location} total={total} itemLabel={total === 1 ? "page" : "pages"} />
    </>
  );
}
