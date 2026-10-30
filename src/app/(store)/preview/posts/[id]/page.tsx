import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeIcon, PencilIcon } from "lucide-react";
import { adminGetPost } from "@/lib/admin/posts";
import { requireAdmin } from "@/lib/admin/auth";
import { NOINDEX } from "@/lib/seo";
import { postHref } from "@/lib/posts/shared";
import { BlogPostArticle } from "@/components/blog-post-article";
import { buttonVariants } from "@/components/ui/button-variants";

export const metadata: Metadata = { title: "Blog post preview", robots: NOINDEX };
export const dynamic = "force-dynamic";
export default async function BlogPostPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/preview/posts/${id}`);
  const post = await adminGetPost(id);
  if (!post) notFound();
  return <>
    <div className="border-b border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100" role="status">
      <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
        <p className="inline-flex items-center gap-2"><EyeIcon className="size-4" /><span><span className="font-semibold">Preview</span> – {post.status === "published" ? "this is how the live article looks right now." : "this article is a draft; only admins can see it."}</span></p>
        <span className="flex items-center gap-2">{post.status === "published" && <Link href={postHref(post.slug)} className={buttonVariants({ variant: "ghost", size: "sm" })}>View live post</Link>}<Link href={`/nemesis/posts/${post.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}><PencilIcon /> Edit post</Link></span>
      </div>
    </div>
    <BlogPostArticle post={post} />
  </>;
}
