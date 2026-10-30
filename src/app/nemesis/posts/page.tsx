import type { Metadata } from "next";
import Link from "next/link";
import { EyeIcon, FileTextIcon, PlusIcon, SquarePenIcon } from "lucide-react";
import { adminListPosts } from "@/lib/admin/posts";
import { listHref } from "@/lib/admin/pagination";
import { resolveListParams, redirectIfClamped } from "@/lib/admin/list-params";
import { formatDate } from "@/lib/format";
import { featuredImage, parsePageStatus } from "@/lib/pages/shared";
import { postHref, postPreviewHref } from "@/lib/posts/shared";
import { deletePost, setPostStatus } from "@/app/nemesis/posts/actions";
import { buttonVariants } from "@/components/ui/button-variants";
import { Badge } from "@/components/ui/badge";
import { FilterSelect } from "@/components/admin/filter-select";
import { DeleteButton, OpenTabButton } from "@/components/admin/form-bits";
import { SearchForm } from "@/components/admin/search-form";
import { ListToolbar, Pagination } from "@/components/admin/pagination";
import { DataTable, EmptyState, PageHeader, Thumb } from "@/components/admin/ui";
import { PageStatusSelect } from "@/components/admin/pages/page-status-select";

export const metadata: Metadata = { title: "Blog posts" };
const LIST_PATH = "/nemesis/posts";
type SearchParams = Promise<{ q?: string; status?: string; page?: string; per?: string; notice?: string; error?: string }>;

export default async function AdminPostsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = parsePageStatus(sp.status);
  const filters = { q: sp.q?.trim() || undefined, status: status || undefined };
  const { perPage, requestedPage } = await resolveListParams(sp);
  const { items: posts, total, page } = await adminListPosts({ ...filters, page: requestedPage, perPage });
  redirectIfClamped(LIST_PATH, filters, sp, requestedPage, page, perPage);
  const listUrl = listHref(LIST_PATH, { ...filters, per: perPage, page });
  const isFiltered = Boolean(filters.q || filters.status);
  const location = { pathname: LIST_PATH, params: filters, page, perPage };
  const editHref = (id: string) => `${LIST_PATH}/${id}?from=${encodeURIComponent(listUrl)}`;
  return <>
    <PageHeader title="Blog posts" description={`${total} ${total === 1 ? "post" : "posts"}${isFiltered ? " match your filter" : ""}. Write and publish articles for your store.`} actions={<Link href={`${LIST_PATH}/new`} className={buttonVariants()}><PlusIcon /> New post</Link>} />
    <ListToolbar {...location}>
      <SearchForm action={LIST_PATH} q={filters.q} placeholder="Search title or slug…" isFiltered={isFiltered} hidden={{ per: perPage }} clearHref={listHref(LIST_PATH, { per: perPage })}>
        <FilterSelect name="status" label="Status" defaultValue={status} options={[{ value: "", label: "All statuses" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }]} />
      </SearchForm>
    </ListToolbar>
    {posts.length === 0 ? <EmptyState title={isFiltered ? "No posts match your filter." : "No blog posts yet."} icon={<FileTextIcon />}>{isFiltered ? "Try a different search or clear the filter." : <>Create your first post to start building your blog.</>}</EmptyState> : <DataTable label="Blog posts" tableClassName="min-w-[820px]" columns={[{ id: "post", label: "Post", className: "pl-4" }, { id: "status", label: "Status" }, { id: "author", label: "Author", cellClassName: "text-muted-foreground" }, { id: "updated", label: "Updated", cellClassName: "text-muted-foreground whitespace-nowrap" }, { id: "published", label: "Published", cellClassName: "text-muted-foreground whitespace-nowrap" }, { id: "actions", label: "Actions", srOnly: true, align: "right", className: "pr-4" }]} rows={posts.map((p) => {
      const image = featuredImage(p);
      return { id: p.id, href: editHref(p.id), cells: [
        <div key="post" className="flex items-center gap-3"><Thumb src={image?.src ?? null} /><div className="min-w-0"><Link href={editHref(p.id)} className="block truncate font-medium hover:underline">{p.title}</Link><p className="truncate text-xs text-muted-foreground">{postHref(p.slug)}{p.tags?.slice(0, 2).map((t) => <Badge key={t.id} variant="outline" className="ml-2 h-4 px-1 text-[10px] font-normal">{t.name}</Badge>)}</p></div></div>,
        <PageStatusSelect key="status" id={p.id} status={p.status} title={p.title} returnTo={listUrl} setStatusAction={setPostStatus} noun="post" />,
        p.author?.full_name || p.author?.email || "—", formatDate(p.updated_at), p.status === "published" && p.published_at ? formatDate(p.published_at) : "—",
        <div key="actions" className="flex items-center justify-end gap-1.5">{p.status === "published" ? <OpenTabButton href={postHref(p.slug)} ariaLabel={`View “${p.title}”`}><EyeIcon className="size-4" /></OpenTabButton> : <OpenTabButton href={postPreviewHref(p.id)} ariaLabel={`Preview “${p.title}”`}><EyeIcon className="size-4" /></OpenTabButton>}<Link href={editHref(p.id)} aria-label={`Edit “${p.title}”`} title={`Edit “${p.title}”`} className={buttonVariants({ variant: "outline", size: "icon-sm" })}><SquarePenIcon className="size-4" /></Link><DeleteButton action={deletePost} id={p.id} returnTo={listUrl} title={`Delete “${p.title}”?`} description={`The post and its public URL ${postHref(p.slug)} are permanently removed. This cannot be undone.`} /></div>,
      ] };
    })} />}
    <Pagination {...location} total={total} itemLabel={total === 1 ? "post" : "posts"} />
  </>;
}
