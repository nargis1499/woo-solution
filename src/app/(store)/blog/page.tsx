import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { CalendarDaysIcon, ArrowRightIcon, NewspaperIcon } from "lucide-react";
import { listPublishedPosts } from "@/lib/data/posts";
import { featuredImage } from "@/lib/pages/shared";
import { postHref } from "@/lib/posts/shared";
import { formatDate } from "@/lib/format";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { AdminEditButton } from "@/components/admin-edit-button";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const base = resolveSiteUrl(settings);
  return {
    title: "Blog",
    description: `Stories, updates and helpful articles from ${settings.store_name}.`,
    alternates: base ? { canonical: `${base}/blog` } : undefined,
    robots: { index: settings.seo_indexing, follow: settings.seo_indexing },
    openGraph: { type: "website", title: `Blog · ${settings.store_name}`, description: `Stories, updates and helpful articles from ${settings.store_name}.`, url: base ? `${base}/blog` : undefined, siteName: settings.store_name },
  };
}

export default async function BlogIndexPage() {
  const posts = await listPublishedPosts(60);
  return <main className="container-page py-10 sm:py-14" data-testid="blog-index">
    <header className="mb-9 border-b pb-8 sm:mb-12 sm:pb-10">
      <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-primary"><NewspaperIcon className="size-4" /> From the journal</p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">Stories, ideas, and updates from our team.</p>
    </header>
    {posts.length ? <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => {
        const image = featuredImage(post);
        const date = post.published_at ?? post.created_at;
        return <article key={post.id} className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md" data-testid="blog-card">
          <Link href={postHref(post.slug)} className="block aspect-[16/10] overflow-hidden bg-muted" aria-label={`Read ${post.title}`}>
            {image ? <Image src={image.src} alt={image.media?.alt ?? ""} fill unoptimized sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><NewspaperIcon className="size-10" /></div>}
          </Link>
          <div className="flex flex-1 flex-col p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CalendarDaysIcon className="size-3.5" /><time dateTime={date}>{formatDate(date)}</time>
              {post.tags?.slice(0, 1).map((tag) => <span key={tag.id} className="ml-auto rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">{tag.name}</span>)}
            </div>
            <h2 className="text-xl font-semibold leading-snug tracking-tight"><Link href={postHref(post.slug)} className="hover:text-primary">{post.title}</Link></h2>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt || "Read the latest from our blog."}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              <Link href={postHref(post.slug)} className="inline-flex items-center gap-2 text-sm font-semibold text-primary">Read article <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" /></Link>
              <AdminEditButton href={`/nemesis/posts/${post.id}`} label="Edit" ariaLabel={`Edit "${post.title}"`} size="xs" />
            </div>
          </div>
        </article>;
      })}
    </div> : <div className="rounded-2xl border border-dashed px-6 py-16 text-center"><NewspaperIcon className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">No articles yet</h2><p className="mt-2 text-sm text-muted-foreground">Check back soon for stories and updates.</p></div>}
  </main>;
}
