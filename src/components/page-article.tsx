import { CalendarIcon } from "lucide-react";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import { getSimpleProductsByIds } from "@/lib/data/products";
import { formatDate } from "@/lib/format";
import { mediaUrl } from "@/lib/media/shared";
import {
  extractContentSegments,
  isBlockEmpty,
  normalizeLayoutCells,
  renderSingleBlockHtml,
  type PageBlock,
} from "@/lib/pages/blocks";
import { sanitizePageHtml } from "@/lib/pages/sanitize";
import { featuredImage } from "@/lib/pages/shared";
import { getSiteSettings } from "@/lib/site-settings";
import type { Page, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AdminEditButton } from "@/components/admin-edit-button";
import { Badge } from "@/components/ui/badge";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SimpleProductBlockCard } from "@/components/simple-product-block-card";

/**
 * Strip editor-only `data-block-*` attributes after `extractContentSegments` has parsed
 * interactive blocks, and demote any body `<h1>` to `<h2>` so `page.title` remains the
 * sole `<h1>` on every CMS page and blog post.
 */
export function cleanStorefrontHtml(html: string): string {
  return html
    .replace(/\s+data-block-(?:json|id|type)=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/<h1(\b[^>]*)>/gi, "<h2$1>")
    .replace(/<\/h1>/gi, "</h2>");
}

/**
 * Storefront template for a CMS page (also used by the admin preview). The
 * content is sanitised again right before rendering – the allow-list in
 * `lib/pages/sanitize.ts` is the only thing between the editor and the DOM.
 * Any `simple_product` or `layout` blocks are hydrated into interactive
 * storefront components with live product data.
 */
export async function PageArticle({
  page,
  className,
  breadcrumbItems,
  editHref,
  editLabel = "Edit page",
}: {
  page: Page;
  className?: string;
  breadcrumbItems?: { label: string; href?: string }[];
  editHref?: string;
  editLabel?: string;
}) {
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
  const segments = extractContentSegments(html);
  const hasInteractiveBlocks = segments.some((s) => s.kind !== "html");

  const productsById = new Map<string, Product>();
  let manageStock = true;
  let canEditProducts = false;
  if (hasInteractiveBlocks) {
    const productIds = new Set<string>();
    for (const seg of segments) {
      if (seg.kind === "simple_product" && seg.block.productId) {
        productIds.add(seg.block.productId);
      } else if (seg.kind === "layout") {
        for (const cell of seg.block.layoutCells ?? []) {
          for (const child of cell) {
            if (child.type === "simple_product" && child.productId) {
              productIds.add(child.productId);
            }
          }
        }
      }
    }
    const ids = [...productIds];
    const [liveProducts, settings, isAdmin] = await Promise.all([
      ids.length > 0 ? getSimpleProductsByIds(ids) : Promise.resolve([]),
      getSiteSettings(),
      isCurrentUserAdmin(),
    ]);
    for (const p of liveProducts) productsById.set(p.id, p);
    manageStock = settings.manage_stock;
    canEditProducts = isAdmin;
  }

  const shownDate =
    page.status === "published" && page.published_at ? page.published_at : page.updated_at;

  return (
    <article className={cn("container-page py-10", className)} data-testid="page-article">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageBreadcrumbs items={breadcrumbItems ?? [{ label: "Home", href: "/" }, { label: page.title }]} />
        {editHref && <AdminEditButton href={editHref} label={editLabel} />}
      </div>

      <header className="mx-auto">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{page.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="size-4" aria-hidden />
            <time dateTime={shownDate}>
              {page.status === "published" ? "Published" : "Updated"} {formatDate(shownDate)}
            </time>
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
            alt={media?.alt || page.title}
            width={media?.width ?? undefined}
            height={media?.height ?? undefined}
            referrerPolicy={media ? undefined : "no-referrer"}
            className="max-h-[600px] w-full rounded-2xl object-cover shadow-sm"
            fetchPriority="high"
            data-testid="page-featured-image"
          />
        </figure>
      )}

      {html ? (
        !hasInteractiveBlocks ? (
          <div className="mx-auto mt-8">
            <div
              className="rich-text rich-text-lg"
              data-testid="page-content"
              dangerouslySetInnerHTML={{ __html: cleanStorefrontHtml(html) }}
            />
          </div>
        ) : (
          <div className="mx-auto mt-8 space-y-6" data-testid="page-content">
            {segments.map((seg, i) => {
              if (seg.kind === "html") {
                const bodyHtml = cleanStorefrontHtml(seg.html);
                if (!bodyHtml.trim()) return null;
                return (
                  <div
                    key={`html-${i}`}
                    className="rich-text rich-text-lg"
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                );
              }
              if (seg.kind === "simple_product") {
                return (
                  <div key={`prod-${seg.block.id}-${i}`} className="my-6">
                    <SimpleProductBlockCard
                      block={seg.block}
                      product={
                        seg.block.productId
                          ? (productsById.get(seg.block.productId) ?? null)
                          : null
                      }
                      manageStock={manageStock}
                      canEdit={canEditProducts}
                    />
                  </div>
                );
              }
              return (
                <StorefrontLayoutBlock
                  key={`layout-${seg.block.id}-${i}`}
                  block={seg.block}
                  productsById={productsById}
                  manageStock={manageStock}
                  canEdit={canEditProducts}
                />
              );
            })}
          </div>
        )
      ) : (
        <p className="mx-auto mt-8 max-w-3xl text-muted-foreground">
          This page has no content yet.
        </p>
      )}
    </article>
  );
}

function StorefrontLayoutBlock({
  block,
  productsById,
  manageStock,
  canEdit,
}: {
  block: PageBlock;
  productsById: Map<string, Product>;
  manageStock: boolean;
  canEdit: boolean;
}) {
  const rows = Math.max(1, Math.min(12, block.layoutRows ?? 1));
  const cols = Math.max(1, Math.min(6, block.layoutCols ?? 2));
  const gap = block.layoutGap ?? "md";
  const valign = block.layoutValign ?? "stretch";
  const cells = normalizeLayoutCells(rows, cols, block.layoutCells);

  return (
    <div
      data-testid="storefront-layout-grid"
      data-layout-rows={rows}
      data-layout-cols={cols}
      className={cn(
        "my-6 grid",
        cols === 1 && "grid-cols-1",
        cols === 2 && "grid-cols-1 md:grid-cols-2",
        cols === 3 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
        cols === 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        cols === 5 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5",
        cols >= 6 && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
        gap === "sm" && "gap-4",
        gap === "md" && "gap-6",
        gap === "lg" && "gap-8",
        valign === "top" && "items-start",
        valign === "center" && "items-center",
        valign === "stretch" && "items-stretch",
      )}
    >
      {cells.map((cellBlocks, cellIdx) => {
        const visibleBlocks = cellBlocks.filter((b) => !isBlockEmpty(b));
        return (
          <div
            key={`cell-${cellIdx}`}
            data-testid={`storefront-layout-cell-${cellIdx}`}
            className="min-w-0 space-y-4"
          >
            {visibleBlocks.map((child, childIdx) =>
              child.type === "simple_product" ? (
                <SimpleProductBlockCard
                  key={`${child.id}-${childIdx}`}
                  block={child}
                  product={
                    child.productId ? (productsById.get(child.productId) ?? null) : null
                  }
                  manageStock={manageStock}
                  canEdit={canEdit}
                />
              ) : (
                <div
                  key={`${child.id}-${childIdx}`}
                  className="rich-text rich-text-lg"
                  dangerouslySetInnerHTML={{
                    __html: cleanStorefrontHtml(
                      sanitizePageHtml(renderSingleBlockHtml(child, false)),
                    ),
                  }}
                />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
