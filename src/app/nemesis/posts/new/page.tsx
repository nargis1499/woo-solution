import type { Metadata } from "next";
import { adminListSimpleProducts, adminListTags } from "@/lib/admin/data";
import { getSiteSettingsFresh, resolveSiteUrl } from "@/lib/site-settings";
import { safeListReturn } from "@/lib/admin/pagination";
import { PostForm } from "@/components/admin/posts/post-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New blog post" };
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const backHref = safeListReturn(from, "/nemesis/posts") ?? "/nemesis/posts";
  const [tags, settings, simpleProducts] = await Promise.all([adminListTags(), getSiteSettingsFresh(), adminListSimpleProducts()]);
  return <>
    <PageHeader title="New post" description="Write with the block editor, tune search and social metadata, then save a draft or publish." backHref={backHref} backLabel="Blog posts" />
    <PostForm tagSuggestions={tags.map((t) => t.name)} simpleProducts={simpleProducts} siteUrl={resolveSiteUrl(settings)} storeName={settings.store_name} returnTo={backHref} />
  </>;
}
