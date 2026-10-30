import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminListSimpleProducts, adminListTags } from "@/lib/admin/data";
import { adminGetPost } from "@/lib/admin/posts";
import { getSiteSettingsFresh, resolveSiteUrl } from "@/lib/site-settings";
import { safeListReturn } from "@/lib/admin/pagination";
import { PostForm } from "@/components/admin/posts/post-form";
import { DeleteButton } from "@/components/admin/form-bits";
import { PageHeader } from "@/components/admin/ui";
import { deletePost } from "@/app/nemesis/posts/actions";

export const metadata: Metadata = { title: "Edit blog post" };
export default async function EditPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  const backHref = safeListReturn(from, "/nemesis/posts") ?? "/nemesis/posts";
  const [post, tags, settings, simpleProducts] = await Promise.all([adminGetPost(id), adminListTags(), getSiteSettingsFresh(), adminListSimpleProducts()]);
  if (!post) notFound();
  return <>
    <PageHeader title={post.title} description={post.status === "published" ? `Live at /blog/${post.slug}` : "Draft – not visible to visitors yet."} backHref={backHref} backLabel="Blog posts" actions={<DeleteButton action={deletePost} id={post.id} returnTo={backHref} label="Delete post" size="default" title={`Delete “${post.title}”?`} description={`The post and its public URL /blog/${post.slug} are permanently removed. This cannot be undone.`} />} />
    <PostForm page={post} tagSuggestions={tags.map((t) => t.name)} simpleProducts={simpleProducts} siteUrl={resolveSiteUrl(settings)} storeName={settings.store_name} returnTo={backHref} />
  </>;
}
