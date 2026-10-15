import type { Metadata } from "next";
import { adminListTags } from "@/lib/admin/data";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { safeListReturn } from "@/lib/admin/pagination";
import { PageForm } from "@/components/admin/pages/page-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New page" };

export default async function NewPagePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const backHref = safeListReturn(from, "/nemesis/pages") ?? "/nemesis/pages";
  const [tags, settings] = await Promise.all([adminListTags(), getSiteSettings()]);
  return (
    <>
      <PageHeader title="New page" description="Write it, save it as a draft or publish it right away." backHref={backHref} backLabel="Pages" />
      <PageForm tagSuggestions={tags.map((t) => t.name)} siteUrl={resolveSiteUrl(settings)} storeName={settings.store_name} returnTo={backHref} />
    </>
  );
}
