import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminGetPage, adminListTags } from "@/lib/admin/data";
import { getSiteSettingsFresh, resolveSiteUrl } from "@/lib/site-settings";
import { safeListReturn } from "@/lib/admin/pagination";
import { deletePage } from "@/app/nemesis/pages/actions";
import { PageForm } from "@/components/admin/pages/page-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Edit page" };

export default async function EditPagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  // Back / Cancel return to the exact list page the admin came from.
  const backHref = safeListReturn(from, "/nemesis/pages") ?? "/nemesis/pages";
  const [page, tags, settings] = await Promise.all([adminGetPage(id), adminListTags(), getSiteSettingsFresh()]);
  if (!page) notFound();

  return (
    <>
      <PageHeader
        title={page.title}
        description={page.status === "published" ? `Live at /${page.slug}` : "Draft – not visible to visitors yet."}
        backHref={backHref}
        backLabel="Pages"
        actions={<DeleteButton action={deletePage} id={page.id} returnTo={backHref} label="Delete page" size="default" title={`Delete "${page.title}"?`} description={`The page and its public URL /${page.slug} are removed permanently. This cannot be undone.`} />}
      />
      <PageForm page={page} tagSuggestions={tags.map((t) => t.name)} siteUrl={resolveSiteUrl(settings)} storeName={settings.store_name} returnTo={backHref} />
    </>
  );
}
