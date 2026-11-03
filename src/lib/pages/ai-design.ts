import type { Product } from "@/lib/types";
import {
  blocksToHtml,
  createBlock,
  isBlockEmpty,
  renderSingleBlockHtml,
  type PageBlock,
} from "./blocks";
import {
  cellDesignClass,
  escapeDesignText,
  layoutDesignClass,
} from "./block-design";

export const AI_DESIGN_MAX_BLOCKS = 48;
export const AI_DESIGN_MAX_BYTES = 60_000;
export type DesignMedia = {
  id: string;
  name: string;
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
};
export type DesignPreview = {
  blocks: PageBlock[];
  html: string;
  model: string;
};

export const AI_DESIGN_SYSTEM_PROMPT = `You design editable ecommerce CMS page BODY sections. Return ONLY a JSON object {"blocks":[...]} without markdown. Never return HTML, CSS, class names, scripts, JSX, metadata, header/footer, forms, or executable code. All text fields are plain text. Do not invent reviews, statistics, product claims, prices, business details or image URLs. Use factual details supplied by the admin. Omit unsupported features rather than simulate them.
Supported blocks and ONLY their allowed fields:
layout: type, cols (1-4), gap (sm|md|lg), valign (top|center|stretch), sectionStyle (plain|soft|accent|contrast), cellStyle (plain|card), cells (array of arrays of child blocks; exactly cols cells). One row per layout. No nested layouts.
heading: type, text, level (h2|h3|h4), align (left|center|right).
paragraph: type, text, variant (normal|lead|muted), align.
callout: type, text, title.
cta: type, heading, subtext, label, href, variant (primary|secondary|outline), align. Only relative internal paths or https links supplied by admin; otherwise use /shop.
list: type, items (1-10 plain strings), style (bullet|ordered).
quote: type, text, author. Only use quotes explicitly provided by admin.
simple_product: type, productId. ONLY use IDs from supplied availableProducts. Product facts and pricing come from the catalog, never the model.
image: type, mediaId, alt, caption. ONLY select IDs from the supplied available media; omit images if none are relevant.
divider: type.
Make 1-8 cohesive sections with a maximum of 48 blocks total (layouts count too), maximum 8 children per cell. Usually compose hero, feature cards, story and CTA using layouts. Use h2 for section headings, h3 within cards. The existing page title is the sole h1. Keep copy concise. FAQs can be heading/paragraph pairs, not interactive accordions. Styles are trusted precompiled presets, not arbitrary Tailwind. Respect requested language.`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a block object.");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new Error(
      "The model returned unsupported block settings. Try a simpler prompt.",
    );
}
function text(value: unknown, max = 1500, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max)
    throw new Error(`Text must be at most ${max} characters.`);
  return value.trim();
}
function choice<const T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T))
    throw new Error("The model returned an unsupported design option.");
  return value as T;
}
function href(value: unknown): string {
  const url = text(value, 500, "/shop");
  if (!/^(?:\/(?!\/)|https:\/\/)/i.test(url) || /[\s\\\u0000-\u001f]/.test(url))
    throw new Error("Use a same-site path or a valid HTTPS link.");
  if (url.startsWith("https:")) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || !parsed.hostname)
      throw new Error("Invalid link.");
  }
  return url;
}

/** Untrusted model JSON is projected into our schema. No spread of model properties. */
export function validateAiDesign(
  raw: string,
  media: DesignMedia[],
  products: Product[] = [],
): PageBlock[] {
  if (
    typeof raw !== "string" ||
    new TextEncoder().encode(raw).length > AI_DESIGN_MAX_BYTES
  )
    throw new Error(
      "The generated design is too large. Request fewer sections.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^<think>[\s\S]*?<\/think>\s*/i, "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error(
      "The model did not return complete design JSON. Try fewer sections or a larger token budget in Settings → AI.",
    );
  }
  const root = object(parsed);
  fields(root, ["blocks"]);
  if (
    !Array.isArray(root.blocks) ||
    !root.blocks.length ||
    root.blocks.length > 12
  )
    throw new Error("Generate between 1 and 12 top-level blocks.");
  let count = 0;
  const parse = (input: unknown, child = false): PageBlock => {
    if (++count > AI_DESIGN_MAX_BLOCKS)
      throw new Error("The design exceeds 48 blocks. Request fewer sections.");
    const b = object(input);
    const id = `ai-${crypto.randomUUID()}`;
    const align = () => choice(b.align, ["left", "center", "right"], "left");
    const inline = () => escapeDesignText(text(b.text));
    const base = { designVersion: 1 as const };
    switch (b.type) {
      case "layout": {
        fields(b, [
          "type",
          "cols",
          "gap",
          "valign",
          "sectionStyle",
          "cellStyle",
          "cells",
        ]);
        if (child) throw new Error("Nested layouts are not supported.");
        const cols = b.cols ?? 1;
        if (
          typeof cols !== "number" ||
          !Number.isInteger(cols) ||
          cols < 1 ||
          cols > 4 ||
          !Array.isArray(b.cells) ||
          b.cells.length !== cols
        )
          throw new Error("Layouts need 1–4 columns with matching cells.");
        const cells = b.cells.map((cell) => {
          if (!Array.isArray(cell) || !cell.length || cell.length > 8)
            throw new Error("Each column needs 1–8 blocks.");
          return cell.map((item) => parse(item, true));
        });
        return createBlock("layout", id, {
          ...base,
          layoutRows: 1,
          layoutCols: cols,
          layoutCells: cells,
          layoutGap: choice(b.gap, ["sm", "md", "lg"], "lg"),
          layoutValign: choice(
            b.valign,
            ["top", "center", "stretch"],
            "center",
          ),
          sectionStyle: choice(
            b.sectionStyle,
            ["plain", "soft", "accent", "contrast"],
            "plain",
          ),
          cellStyle: choice(b.cellStyle, ["plain", "card"], "plain"),
        });
      }
      case "heading":
        fields(b, ["type", "text", "level", "align"]);
        return createBlock("heading", id, {
          ...base,
          html: inline(),
          level: choice(b.level, ["h2", "h3", "h4"], "h2"),
          align: align(),
        });
      case "paragraph":
        fields(b, ["type", "text", "variant", "align"]);
        return createBlock("paragraph", id, {
          ...base,
          html: inline(),
          variant: choice(b.variant, ["normal", "lead", "muted"], "normal"),
          align: align(),
        });
      case "callout":
        fields(b, ["type", "text", "title"]);
        return createBlock("callout", id, {
          ...base,
          html: inline(),
          calloutTitle: text(b.title, 160),
        });
      case "cta":
        fields(b, [
          "type",
          "heading",
          "subtext",
          "label",
          "href",
          "variant",
          "align",
        ]);
        return createBlock("cta", id, {
          ...base,
          ctaHeading: text(b.heading, 160),
          ctaSubtext: text(b.subtext, 500),
          buttonText: text(b.label, 80, "Explore collection"),
          buttonHref: href(b.href),
          buttonVariant: choice(
            b.variant,
            ["primary", "secondary", "outline"],
            "primary",
          ),
          align: align(),
        });
      case "list": {
        fields(b, ["type", "items", "style"]);
        if (!Array.isArray(b.items) || !b.items.length || b.items.length > 10)
          throw new Error("Lists need 1–10 items.");
        return createBlock("list", id, {
          ...base,
          items: b.items.map((item) => escapeDesignText(text(item, 500))),
          listStyle: choice(b.style, ["bullet", "ordered"], "bullet"),
        });
      }
      case "quote":
        fields(b, ["type", "text", "author"]);
        return createBlock("quote", id, {
          ...base,
          html: inline(),
          quoteAuthor: text(b.author, 160),
        });
      case "divider":
        fields(b, ["type"]);
        return createBlock("divider", id, base);
      case "simple_product": {
        fields(b, ["type", "productId"]);
        const product = products.find(
          (p) =>
            p.id === b.productId &&
            (p.type ?? "simple") === "simple" &&
            p.is_active,
        );
        if (!product)
          throw new Error(
            "The selected product is unavailable. Generate again or add a product manually.",
          );
        return createBlock("simple_product", id, {
          ...base,
          productId: product.id,
          productSlug: product.slug,
          productName: product.name,
          productCategoryName: product.category?.name ?? "FEATURED",
          productCategorySlug: product.category?.slug ?? null,
          productImageUrl: product.image_url,
          productPriceMicros: product.price_micros,
          productCompareAtMicros: product.compare_at_price_micros,
          productStock: product.stock,
          productDescription: product.description,
          productShowRating: false,
          productShowDescription: false,
          productRating: "",
          productReviewCount: "",
          productImageShape: "rounded",
        });
      }
      case "image": {
        fields(b, ["type", "mediaId", "alt", "caption"]);
        const image = media.find((m) => m.id === b.mediaId);
        if (!image)
          throw new Error(
            "An image is not available in the supplied Media Library selection. Generate again or add it manually.",
          );
        return createBlock("image", id, {
          ...base,
          src: image.src,
          mediaId: image.id,
          alt: text(b.alt, 300, image.alt),
          caption: text(b.caption, 500),
          imageWidth: image.width,
          imageHeight: image.height,
        });
      }
      default:
        throw new Error("The model returned an unsupported block type.");
    }
  };
  const blocks = root.blocks.map((b) => parse(b));
  const meaningful = (b: PageBlock): boolean =>
    b.type === "layout"
      ? (b.layoutCells ?? []).flat().some(meaningful)
      : b.type !== "divider" && !isBlockEmpty(b);
  if (!blocks.some(meaningful))
    throw new Error("The model returned an empty design.");
  if (new TextEncoder().encode(blocksToHtml(blocks)).length > 150_000)
    throw new Error("The design content is too large.");
  return blocks;
}

/** Same trusted templates and responsive layout utilities as the storefront. */
export function designPreviewHtml(blocks: PageBlock[]): string {
  const render = (block: PageBlock) =>
    block.type === "simple_product"
      ? `<div class="rounded-xl border border-current/15 p-5 space-y-3"><h3 class="text-lg font-semibold">${escapeDesignText(block.productName ?? "Product")}</h3><p class="text-sm leading-6 opacity-80">Catalog product — live price and cart controls appear in the editor and storefront.</p></div>`
      : renderSingleBlockHtml(block, false);
  return blocks
    .map((block) =>
      block.type === "layout"
        ? `<div class="${layoutDesignClass(block)}">${(block.layoutCells ?? []).map((cell) => `<div class="${cellDesignClass(block)}">${cell.map(render).join("")}</div>`).join("")}</div>`
        : render(block),
    )
    .join("\n");
}
