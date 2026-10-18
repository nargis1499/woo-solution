import { CalendarIcon } from "lucide-react";
import { formatDate } from "@/lib/format";
import { mediaUrl } from "@/lib/media/shared";
import { sanitizePageHtml } from "@/lib/pages/sanitize";
import { featuredImage } from "@/lib/pages/shared";
import type { Page } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

/**
 * Storefront template for a CMS page (also used by the admin preview). The
 * content is sanitised again right before rendering – the allow-list in
 * `lib/pages/sanitize.ts` is the only thing between the editor and the DOM.
 */
export function PageArticle({ page, className }: { page: Page; className?: string }) {
  // Media Library file (with responsive renditions) or a pasted external URL.
  const image = featuredImage(page);
  const media = image?.media ?? null;
  const srcSet = media
    ? [media.variants.medium, media.variants.large]
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map((v) => `${mediaUrl(v.path)} ${v.width}w`)
        .concat(media.width ? [`${mediaUrl(media.path)} ${media.width}w`] : [])
        .join(", ")
    : undefined;
  const html = sanitizePageHtml(page.content);
  const shownDate = page.status === "published" && page.published_at ? page.published_at : page.updated_at;

  return (
    <article className={cn("container-page py-10", className)} data-testid="page-article">
      <PageBreadcrumbs className="mb-6" items={[{ label: "Home", href: "/" }, { label: page.title }]} />

      <header className="mx-auto">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{page.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="size-4" aria-hidden />
            <time dateTime={shownDate}>{page.status === "published" ? "Published" : "Updated"} {formatDate(shownDate)}</time>
          </span>
          {page.tags && page.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {page.tags.map((t) => (
                <li key={t.id}>
                  <Badge variant="secondary">{t.name}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {image && (
        <figure className="mx-auto mt-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            srcSet={srcSet || undefined}
            sizes="(min-width: 1024px) 1024px, 100vw"
            alt={media?.alt ?? ""}
            width={media?.width ?? undefined}
            height={media?.height ?? undefined}
            referrerPolicy={media ? undefined : "no-referrer"}
            className="h-auto w-full rounded-2xl object-cover shadow-sm"
            fetchPriority="high"
            data-testid="page-featured-image"
          />
        </figure>
      )}

      {html ? (
        <div className="mx-auto mt-8">
          <div className="rich-text rich-text-lg" data-testid="page-content" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <p className="mx-auto mt-8 max-w-3xl text-muted-foreground">This page has no content yet.</p>
      )}
    </article>
  );
}
