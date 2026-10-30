import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { CalendarDaysIcon, ArrowRightIcon, NewspaperIcon } from "lucide-react";
import { listPublishedPosts } from "@/lib/data/posts";
import { featuredImage } from "@/lib/pages/shared";
import { postHref } from "@/lib/posts/shared";
import { formatDate } from "@/lib/format";
import {
  blogIndexJsonLd,
  breadcrumbJsonLd,
  robotsFor,
  serializeJsonLd,
} from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { AdminEditButton } from "@/components/admin-edit-button";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const base = resolveSiteUrl(settings);
  const description = `Stories, updates and helpful articles from ${settings.store_name}.`;
  const image = settings.seo_og_image_url ?? undefined;

  return {
    title: "Blog",
    description,
    alternates: base ? { canonical: `${base}/blog` } : undefined,
    robots: robotsFor({ index: settings.seo_indexing, follow: settings.seo_indexing }),
    openGraph: {
      type: "website",
      title: `Blog · ${settings.store_name}`,
      description,
      url: base ? `${base}/blog` : undefined,
      siteName: settings.store_name,
      images: image ? [{ url: image, alt: `Blog · ${settings.store_name}` }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      site: settings.seo_twitter ? `@${settings.seo_twitter}` : undefined,
      title: `Blog · ${settings.store_name}`,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BlogIndexPage() {
  const [posts, settings] = await Promise.all([listPublishedPosts(60), getSiteSettings()]);
  const base = resolveSiteUrl(settings);
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Blog" }];
  const structuredData = [
    blogIndexJsonLd(posts, settings),
    breadcrumbJsonLd(base, breadcrumbItems, "/blog"),
  ].filter(Boolean);

  return (
    <div className="container-page py-10 sm:py-14" data-testid="blog-index">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <PageBreadcrumbs className="mb-6" items={breadcrumbItems} />

      <header className="mb-9 border-b pb-8 sm:mb-12 sm:pb-10">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <NewspaperIcon className="size-4" aria-hidden /> From the journal
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Stories, ideas, and updates from our team.</p>
      </header>

      {posts.length ? (
        <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const image = featuredImage(post);
            const date = post.published_at ?? post.created_at;
            return (
              <article
                key={post.id}
                className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md"
                data-testid="blog-card"
              >
                <Link
                  href={postHref(post.slug)}
                  className="relative block aspect-[16/10] overflow-hidden bg-muted"
                  aria-label={`Read ${post.title}`}
                >
                  {image ? (
                    <Image
                      src={image.src}
                      alt={image.media?.alt || post.title}
                      fill
                      unoptimized
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <NewspaperIcon className="size-10" aria-hidden />
                    </div>
                  )}
                </Link>
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDaysIcon className="size-3.5" aria-hidden />
                    <time dateTime={date}>{formatDate(date)}</time>
                    {post.tags?.slice(0, 1).map((tag) => (
                      <span
                        key={tag.id}
                        className="ml-auto rounded-full bg-muted px-2.5 py-1 font-medium text-foreground"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-xl font-semibold leading-snug tracking-tight">
                    <Link href={postHref(post.slug)} className="hover:text-primary">
                      {post.title}
                    </Link>
                  </h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {post.excerpt || "Read the latest from our blog."}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                    <Link
                      href={postHref(post.slug)}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
                    >
                      Read article{" "}
                      <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                    </Link>
                    <AdminEditButton
                      href={`/nemesis/posts/${post.id}`}
                      label="Edit"
                      ariaLabel={`Edit "${post.title}"`}
                      size="xs"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed px-6 py-16 text-center">
          <NewspaperIcon className="mx-auto size-9 text-muted-foreground" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">No articles yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Check back soon for stories and updates.</p>
        </div>
      )}
    </div>
  );
}
