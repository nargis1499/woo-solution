import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPost } from "@/lib/data/posts";
import { postHref, postSeo } from "@/lib/posts/shared";
import {
  breadcrumbJsonLd,
  NOINDEX,
  postJsonLd,
  robotsFor,
  serializeJsonLd,
} from "@/lib/seo";
import { getSiteSettings, resolveSiteUrl } from "@/lib/site-settings";
import { BlogPostArticle } from "@/components/blog-post-article";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  return getPublishedPost(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const [post, settings] = await Promise.all([load(slug), getSiteSettings()]);
  if (!post) return { title: "Article not found", robots: NOINDEX };
  const seo = postSeo(post, resolveSiteUrl(settings), settings.seo_indexing);
  const image = seo.ogImage ?? settings.seo_og_image_url ?? undefined;
  return {
    title: seo.title,
    description: seo.description ?? undefined,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    robots: robotsFor(seo.robots),
    openGraph: {
      type: "article",
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      url: seo.canonical ?? undefined,
      siteName: settings.store_name,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      authors: post.author?.full_name ? [post.author.full_name] : undefined,
      tags: post.tags?.map((t) => t.name),
      images: image ? [{ url: image, alt: post.og_image?.alt ?? post.featured_image?.alt ?? seo.ogTitle }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      site: settings.seo_twitter ? `@${settings.seo_twitter}` : undefined,
      title: seo.ogTitle,
      description: seo.ogDescription ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { slug } = await params;
  const [post, settings] = await Promise.all([load(slug), getSiteSettings()]);
  if (!post) notFound();

  const base = resolveSiteUrl(settings);
  const path = postHref(post.slug);
  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Blog", href: "/blog" },
    { label: post.title },
  ];
  const structuredData = [
    postJsonLd(post, settings),
    breadcrumbJsonLd(base, breadcrumbItems, path),
  ].filter(Boolean);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <BlogPostArticle post={post} editHref={`/nemesis/posts/${post.id}`} editLabel="Edit post" />
    </>
  );
}
