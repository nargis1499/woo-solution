"use client";

import { ImageIcon } from "lucide-react";
import {
  DESIGN_CLASSES,
  cellDesignClass,
  layoutDesignClass,
} from "@/lib/pages/block-design";
import { normalizeLayoutCells, type PageBlock } from "@/lib/pages/blocks";
import { htmlToText } from "@/lib/pages/shared";
import { cn } from "@/lib/utils";

function copy(html = "") {
  try {
    return htmlToText(html);
  } catch {
    return html.replace(/<[^>]*>/g, "");
  }
}

export function sectionLabel(block: PageBlock): string {
  if (block.type === "layout") {
    const children = (block.layoutCells ?? []).flat();
    if ((block.layoutCols ?? 1) >= 3)
      return block.cellStyle === "card" ? "Feature grid" : "Content grid";
    if (
      children.some((b) => b.type === "image") &&
      children.some((b) => b.type === "heading")
    )
      return "Hero section";
    if (children.some((b) => b.type === "cta")) return "Call to action";
    return "Content section";
  }
  return {
    heading: "Heading",
    paragraph: "Text",
    callout: "Callout",
    image: "Image banner",
    simple_product: "Product",
    cta: "Call to action",
    list: "List",
    quote: "Quote",
    divider: "Divider",
  }[block.type];
}

/** Safe React-only visual summary. Raw persisted/editor HTML never enters innerHTML. */
export function BlockVisualPreview({
  block,
  depth = 0,
}: {
  block: PageBlock;
  depth?: number;
}) {
  const d = DESIGN_CLASSES;
  const align = d.align[block.align ?? "left"] ?? d.align.left;
  if (depth > 2)
    return <p className="text-sm text-muted-foreground">Nested content</p>;
  switch (block.type) {
    case "layout":
      return (
        <div
          className={
            block.designVersion === 1
              ? layoutDesignClass(block)
              : cn("rounded-xl bg-muted/30 p-5", layoutDesignClass(block))
          }
        >
          {normalizeLayoutCells(
            block.layoutRows ?? 1,
            block.layoutCols ?? 2,
            block.layoutCells,
          ).map((cell, i) => (
            <div key={i} className={cellDesignClass(block)}>
              {cell.map((child, n) => (
                <BlockVisualPreview
                  key={`${child.id}-${n}`}
                  block={child}
                  depth={depth + 1}
                />
              ))}
            </div>
          ))}
        </div>
      );
    case "heading":
      return (
        <p
          className={cn(d.heading[block.level ?? "h2"] ?? d.heading.h2, align)}
        >
          {copy(block.html) || "Your heading"}
        </p>
      );
    case "paragraph":
      return (
        <p
          className={cn(
            d.paragraph[block.variant ?? "normal"] ?? d.paragraph.normal,
            align,
          )}
        >
          {copy(block.html) || "Add your content…"}
        </p>
      );
    case "image":
      return (
        <figure className={align}>
          {block.src && /^(?:https?:\/\/|\/(?!\/))/i.test(block.src) ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.src}
                alt={block.alt ?? ""}
                width={block.imageWidth ?? undefined}
                height={block.imageHeight ?? undefined}
                loading="lazy"
                className="max-h-96 w-full rounded-lg object-cover"
              />
            </>
          ) : (
            <div className="grid aspect-video place-items-center rounded-lg bg-muted text-muted-foreground">
              <ImageIcon className="size-8" />
            </div>
          )}
          {block.caption && (
            <figcaption className={d.caption}>{block.caption}</figcaption>
          )}
        </figure>
      );
    case "cta":
      return (
        <div className={cn(d.stack, align)}>
          {block.ctaHeading && <p className={d.title}>{block.ctaHeading}</p>}
          {block.ctaSubtext && (
            <p className="text-sm leading-6">{block.ctaSubtext}</p>
          )}
          <span
            className={
              d.button[block.buttonVariant ?? "primary"] ?? d.button.primary
            }
          >
            {block.buttonText || "Explore collection"} →
          </span>
        </div>
      );
    case "callout":
      return (
        <div className={d.callout}>
          {block.calloutTitle && (
            <p className={d.title}>{block.calloutTitle}</p>
          )}
          <p>{copy(block.html)}</p>
        </div>
      );
    case "list": {
      const Tag = block.listStyle === "ordered" ? "ol" : "ul";
      return (
        <Tag className={Tag === "ol" ? d.ordered : d.bullets}>
          {(block.items ?? []).map((item, i) => (
            <li key={i}>{copy(item)}</li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className={cn(d.quote, align)}>
          <p>{copy(block.html)}</p>
          {block.quoteAuthor && (
            <p className={d.caption}>— {block.quoteAuthor}</p>
          )}
        </blockquote>
      );
    case "divider":
      return <hr className={d.divider} />;
    case "simple_product":
      return (
        <div className="flex items-center gap-5 rounded-xl border border-border bg-card p-5 text-card-foreground">
          {block.productImageUrl &&
            /^https?:\/\//i.test(block.productImageUrl) && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={block.productImageUrl}
                  alt=""
                  loading="lazy"
                  className="size-24 rounded-lg object-cover"
                />
              </>
            )}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {block.productCategoryName || "Product"}
            </p>
            <p className="text-lg font-semibold">
              {block.productName || "Select a product"}
            </p>
            <span className={d.button.primary}>
              {block.productButtonText || "Add to cart"}
            </span>
          </div>
        </div>
      );
  }
}
