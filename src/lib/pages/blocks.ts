/*
 * Structured modular block engine for CMS Pages.
 *
 * Each block is a typed JSON object in the admin Block Editor and serialises
 * into clean, semantic HTML annotated with `data-block-*` attributes so:
 *   1. `pages.content` works without any database schema changes,
 *   2. `sanitizePageHtml`, `htmlToText` (SEO) and `mediaIdsFromHtml` (Media
 *      Library usage tracking) work out of the box,
 *   3. Re-opening a saved page in the Block Editor restores the exact block
 *      tree (`id`, `type`, settings and inline formatting), and
 *   4. Existing legacy HTML pages automatically convert into blocks.
 */

export type BlockType =
  | "layout"
  | "heading"
  | "paragraph"
  | "callout"
  | "image"
  | "simple_product"
  | "cta"
  | "list"
  | "quote"
  | "divider";

export type HeadingLevel = "h1" | "h2" | "h3" | "h4";
export type TextAlign = "left" | "center" | "right";
export type ParagraphVariant = "normal" | "lead" | "muted";
export type CalloutTone = "info" | "success" | "warning" | "danger";
export type ImageLayout = "full" | "custom";
export type ProductImageShape = "circle" | "rounded";
export type CtaVariant = "primary" | "secondary" | "outline";
export type ListStyle = "bullet" | "ordered";
export type DividerStyle = "solid" | "dashed" | "dots";
export type LayoutGap = "sm" | "md" | "lg";
export type LayoutValign = "top" | "center" | "stretch";

export type PageBlock = {
  id: string;
  type: BlockType;
  /** Rich inline HTML for heading, paragraph, callout, quote */
  html?: string;
  // Layout (Rows × Columns Grid)
  layoutRows?: number;
  layoutCols?: number;
  layoutGap?: LayoutGap;
  layoutValign?: LayoutValign;
  /** `rows * cols` cells in row-major order; each cell holds an array of child blocks. */
  layoutCells?: PageBlock[][];
  // Heading
  level?: HeadingLevel;
  align?: TextAlign;
  // Paragraph
  variant?: ParagraphVariant;
  // Callout
  tone?: CalloutTone;
  calloutTitle?: string;
  // Image / Hero Banner
  src?: string;
  mediaId?: string | null;
  alt?: string;
  caption?: string;
  imageLayout?: ImageLayout;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageMaxHeight?: number | null;
  // Simple Product (horizontal product card)
  productId?: string | null;
  productSlug?: string;
  productName?: string;
  productCategoryName?: string | null;
  productCategorySlug?: string | null;
  productImageUrl?: string | null;
  productPriceMicros?: number;
  productCompareAtMicros?: number | null;
  productStock?: number;
  productDescription?: string | null;
  productImageShape?: ProductImageShape;
  productBadgeText?: string;
  productShowRating?: boolean;
  productRating?: string;
  productReviewCount?: string;
  productShowDescription?: boolean;
  productButtonText?: string;
  // CTA Button
  ctaHeading?: string;
  ctaSubtext?: string;
  buttonText?: string;
  buttonHref?: string;
  buttonVariant?: CtaVariant;
  newTab?: boolean;
  // List
  listStyle?: ListStyle;
  items?: string[];
  // Quote
  quoteAuthor?: string;
  // Divider
  dividerStyle?: DividerStyle;
};

export type BlockDefinition = {
  type: BlockType;
  label: string;
  description: string;
  badge: string;
  keywords: string[];
};

export const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    type: "layout",
    label: "Row & Column Layout",
    description: "Custom rows & columns grid that holds other blocks inside each column",
    badge: "GRID",
    keywords: ["layout", "grid", "row", "rows", "column", "columns", "container", "split"],
  },
  {
    type: "heading",
    label: "Heading",
    description: "Large title or section header",
    badge: "H",
    keywords: ["heading", "title", "h1", "h2", "h3", "h4", "header"],
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Standard body text content",
    badge: "¶",
    keywords: ["paragraph", "text", "body", "copy", "p"],
  },
  {
    type: "callout",
    label: "Callout Box",
    description: "Highlight important info or quotes",
    badge: "!",
    keywords: ["callout", "alert", "notice", "info", "warning", "box", "tip"],
  },
  {
    type: "image",
    label: "Hero / Image Banner",
    description: "Full width image with caption",
    badge: "IMG",
    keywords: ["image", "hero", "banner", "photo", "picture", "media"],
  },
  {
    type: "simple_product",
    label: "Simple Product",
    description: "Horizontal simple product card with quantity & add to cart",
    badge: "PRD",
    keywords: ["product", "simple", "card", "shop", "cart", "buy", "horizontal", "ecommerce"],
  },
  {
    type: "cta",
    label: "Call to Action Button",
    description: "Interactive button with external/internal link",
    badge: "CTA",
    keywords: ["cta", "button", "link", "action", "banner"],
  },
  {
    type: "list",
    label: "Bullet / Numbered List",
    description: "Structured bulleted or numbered list items",
    badge: "•",
    keywords: ["list", "bullet", "numbered", "ul", "ol", "items"],
  },
  {
    type: "quote",
    label: "Blockquote",
    description: "Editorial quote with optional attribution",
    badge: "❝",
    keywords: ["quote", "blockquote", "citation", "testimonial"],
  },
  {
    type: "divider",
    label: "Section Divider",
    description: "Visual horizontal separator between sections",
    badge: "—",
    keywords: ["divider", "hr", "separator", "line"],
  },
];

export function normalizeLayoutCells(
  rows: number,
  cols: number,
  existing?: PageBlock[][],
): PageBlock[][] {
  const safeRows = Math.max(1, Math.min(12, Math.round(rows || 1)));
  const safeCols = Math.max(1, Math.min(6, Math.round(cols || 2)));
  const total = safeRows * safeCols;
  const src = Array.isArray(existing) ? existing : [];
  const out: PageBlock[][] = [];
  for (let i = 0; i < total; i++) {
    out.push(Array.isArray(src[i]) ? src[i] : []);
  }
  return out;
}

export function createBlock(type: BlockType, id: string, overrides?: Partial<PageBlock>): PageBlock {
  const base: PageBlock = { id, type };
  switch (type) {
    case "layout": {
      const rows = overrides?.layoutRows ?? 1;
      const cols = overrides?.layoutCols ?? 2;
      return {
        ...base,
        layoutRows: rows,
        layoutCols: cols,
        layoutGap: "md",
        layoutValign: "stretch",
        layoutCells: normalizeLayoutCells(rows, cols, overrides?.layoutCells),
        ...overrides,
      };
    }
    case "heading":
      return { ...base, level: "h1", align: "left", html: "", ...overrides };
    case "paragraph":
      return { ...base, variant: "normal", align: "left", html: "", ...overrides };
    case "callout":
      return {
        ...base,
        tone: "info",
        calloutTitle: "Important note",
        html: "",
        ...overrides,
      };
    case "image":
      return {
        ...base,
        src: "",
        mediaId: null,
        alt: "",
        caption: "",
        imageLayout: "full",
        imageWidth: null,
        imageHeight: null,
        imageMaxHeight: null,
        align: "center",
        ...overrides,
      };
    case "simple_product":
      return {
        ...base,
        productId: null,
        productSlug: "",
        productName: "Sony WH-1000XM5 Noise-Canceling",
        productCategoryName: "AUDIO GEAR",
        productCategorySlug: null,
        productImageUrl: null,
        productPriceMicros: 348_000_000,
        productCompareAtMicros: 399_990_000,
        productStock: 25,
        productDescription:
          "Industry-leading noise cancellation with 30-hour battery life and ultra-comfortable lightweight design.",
        productImageShape: "circle",
        productBadgeText: "",
        productShowRating: true,
        productRating: "4.9",
        productReviewCount: "420",
        productShowDescription: false,
        productButtonText: "ADD TO CART",
        ...overrides,
      };
    case "cta":
      return {
        ...base,
        ctaHeading: "",
        ctaSubtext: "",
        buttonText: "Explore collection",
        buttonHref: "/shop",
        buttonVariant: "primary",
        align: "left",
        newTab: false,
        ...overrides,
      };
    case "list":
      return {
        ...base,
        listStyle: "bullet",
        items: [""],
        ...overrides,
      };
    case "quote":
      return {
        ...base,
        html: "",
        quoteAuthor: "",
        align: "left",
        ...overrides,
      };
    case "divider":
      return {
        ...base,
        dividerStyle: "solid",
        ...overrides,
      };
  }
}

export function defaultInitialBlocks(): PageBlock[] {
  return [];
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

export function isBlockEmpty(block: PageBlock): boolean {
  switch (block.type) {
    case "layout":
      return false;
    case "heading":
    case "paragraph":
      return stripTags(block.html ?? "") === "";
    case "callout":
      return stripTags(block.html ?? "") === "" && !(block.calloutTitle ?? "").trim();
    case "quote":
      return stripTags(block.html ?? "") === "" && !(block.quoteAuthor ?? "").trim();
    case "image":
      return !(block.src ?? "").trim();
    case "simple_product":
      return false;
    case "cta":
      return !(block.buttonText ?? "").trim() && !(block.ctaHeading ?? "").trim();
    case "list":
      return !(block.items ?? []).some((item) => stripTags(item) !== "");
    case "divider":
      return false;
  }
}

/**
 * Serialises a single non-layout block into semantic HTML (used both for
 * top-level blocks and for rendering non-product blocks inside a layout cell).
 */
export function renderSingleBlockHtml(block: PageBlock, includeJsonMeta = true): string {
  const metaAttr = includeJsonMeta ? ` data-block-json="${escapeAttr(JSON.stringify(block))}"` : "";
  const idAttr = includeJsonMeta
    ? ` data-block-id="${escapeAttr(block.id)}" data-block-type="${escapeAttr(block.type)}"${metaAttr}`
    : "";
  const alignStyle =
    block.align && block.align !== "left" ? ` style="text-align: ${block.align}"` : "";

  switch (block.type) {
    case "heading": {
      const tag = block.level && /^h[1-4]$/.test(block.level) ? block.level : "h2";
      return `<${tag}${idAttr}${alignStyle}>${block.html ?? ""}</${tag}>`;
    }
    case "paragraph": {
      const cls =
        block.variant === "lead"
          ? ' class="page-block-lead"'
          : block.variant === "muted"
            ? ' class="page-block-muted"'
            : "";
      return `<p${idAttr}${cls}${alignStyle}>${block.html ?? ""}</p>`;
    }
    case "callout": {
      const tone = block.tone ?? "info";
      const titleHtml = block.calloutTitle?.trim()
        ? `<p class="page-callout-title"><strong>${escapeHtml(block.calloutTitle.trim())}</strong></p>`
        : "";
      return `<div class="page-block-callout page-callout-${escapeAttr(tone)}"${idAttr}>${titleHtml}<div class="page-callout-body">${block.html ?? ""}</div></div>`;
    }
    case "image": {
      const rawLayout = block.imageLayout as string | undefined;
      const layout: ImageLayout = rawLayout === "custom" ? "custom" : "full";
      const align: TextAlign = block.align ?? "center";
      const mediaAttr = block.mediaId ? ` data-media-id="${escapeAttr(block.mediaId)}"` : "";
      const alt = escapeAttr(block.alt ?? "");
      const src = escapeAttr(block.src ?? "");
      const w =
        layout === "custom" && block.imageWidth && block.imageWidth > 0
          ? Math.round(block.imageWidth)
          : null;
      const h =
        layout === "custom" && block.imageHeight && block.imageHeight > 0
          ? Math.round(block.imageHeight)
          : null;
      const maxH =
        block.imageMaxHeight && block.imageMaxHeight > 0
          ? Math.round(block.imageMaxHeight)
          : null;
      const dimAttrs = `${w ? ` width="${w}"` : ""}${h ? ` height="${h}"` : ""}`;
      const styleParts: string[] = [];
      if (layout === "custom") {
        if (w) styleParts.push(`width: ${w}px`);
        if (h) styleParts.push(`height: ${h}px`);
        styleParts.push("object-fit: cover");
      } else {
        styleParts.push("width: 100%");
      }
      if (maxH) {
        styleParts.push(`max-height: ${maxH}px`);
        if (!styleParts.includes("object-fit: cover")) styleParts.push("object-fit: cover");
      }
      const imgStyle = styleParts.length ? ` style="${styleParts.join("; ")}"` : "";
      const captionHtml = block.caption?.trim()
        ? `<figcaption>${escapeHtml(block.caption.trim())}</figcaption>`
        : "";
      return `<figure class="page-block-image page-image-${escapeAttr(layout)} page-image-align-${escapeAttr(align)}"${idAttr} style="text-align: ${align}"><img src="${src}" alt="${alt}"${mediaAttr}${dimAttrs}${imgStyle} loading="lazy" />${captionHtml}</figure>`;
    }
    case "simple_product": {
      // IMPORTANT: No nested <div> inside `.page-block-product` so `extractContentSegments`
      // can split `<div ... data-block-type="simple_product" ...>...</div>` deterministically.
      const name = escapeHtml(block.productName?.trim() || "Simple Product");
      const cat = escapeHtml(
        (block.productBadgeText?.trim() || block.productCategoryName || "FEATURED").toUpperCase(),
      );
      const href = block.productSlug ? `/products/${escapeAttr(block.productSlug)}` : "/shop";
      return `<div class="page-block-product"${idAttr}><p class="page-product-fallback"><span class="page-product-badge">${cat}</span> <strong><a href="${href}">${name}</a></strong></p></div>`;
    }
    case "cta": {
      const variant = block.buttonVariant ?? "primary";
      const targetAttr = block.newTab ? ' target="_blank" rel="noopener noreferrer"' : "";
      const headingHtml = block.ctaHeading?.trim()
        ? `<h3 class="page-cta-heading">${escapeHtml(block.ctaHeading.trim())}</h3>`
        : "";
      const subtextHtml = block.ctaSubtext?.trim()
        ? `<p class="page-cta-subtext">${escapeHtml(block.ctaSubtext.trim())}</p>`
        : "";
      const href = escapeAttr(block.buttonHref?.trim() || "#");
      const label = escapeHtml(block.buttonText?.trim() || "Learn more");
      return `<div class="page-block-cta page-cta-${escapeAttr(variant)}"${idAttr}${alignStyle}>${headingHtml}${subtextHtml}<p class="page-cta-action"><a href="${href}" class="page-cta-button page-cta-button-${escapeAttr(variant)}"${targetAttr}>${label}</a></p></div>`;
    }
    case "list": {
      const tag = block.listStyle === "ordered" ? "ol" : "ul";
      const items = (block.items ?? [])
        .filter((item) => stripTags(item) !== "")
        .map((item) => `<li>${item}</li>`)
        .join("");
      return `<${tag}${idAttr}>${items}</${tag}>`;
    }
    case "quote": {
      const authorHtml = block.quoteAuthor?.trim()
        ? `<figcaption class="page-quote-author">— ${escapeHtml(block.quoteAuthor.trim())}</figcaption>`
        : "";
      return `<blockquote class="page-block-quote"${idAttr}${alignStyle}><p>${block.html ?? ""}</p>${authorHtml}</blockquote>`;
    }
    case "divider": {
      const style = block.dividerStyle ?? "solid";
      return `<hr class="page-block-divider page-divider-${escapeAttr(style)}"${idAttr} />`;
    }
    case "layout": {
      // IMPORTANT: No nested <div> inside `.page-block-layout` AND no `data-block-json` on
      // inner elements so `htmlToBlocks` and `extractContentSegments` match the top-level
      // `<div class="page-block-layout" ...>...</div>` deterministically while preserving
      // `<img data-media-id="...">` and SEO text content.
      const rows = Math.max(1, Math.min(12, block.layoutRows ?? 1));
      const cols = Math.max(1, Math.min(6, block.layoutCols ?? 2));
      const cells = normalizeLayoutCells(rows, cols, block.layoutCells);
      const normalizedBlock: PageBlock = {
        ...block,
        layoutRows: rows,
        layoutCols: cols,
        layoutCells: cells,
      };
      const meta = escapeAttr(JSON.stringify(normalizedBlock));
      const innerSummary = cells
        .flatMap((cell) => cell)
        .filter((child) => !isBlockEmpty(child))
        .map((child) => {
          if (child.type === "image" && child.src) {
            const mAttr = child.mediaId ? ` data-media-id="${escapeAttr(child.mediaId)}"` : "";
            return `<img src="${escapeAttr(child.src)}" alt="${escapeAttr(child.alt ?? "")}"${mAttr} loading="lazy" />`;
          }
          if (child.type === "simple_product") {
            return `<span>${escapeHtml(child.productName || "Simple Product")}</span>`;
          }
          if (child.type === "cta") {
            return `<span>${escapeHtml(child.ctaHeading || child.buttonText || "")}</span>`;
          }
          if (child.type === "list") {
            return `<span>${(child.items ?? []).map((it) => escapeHtml(stripTags(it))).join(" ")}</span>`;
          }
          return `<span>${escapeHtml(stripTags(child.html ?? ""))}</span>`;
        })
        .join(" ");
      return `<div class="page-block-layout" data-block-id="${escapeAttr(block.id)}" data-block-type="layout" data-block-json="${meta}"><p class="page-layout-fallback">${innerSummary || `Layout (${rows}x${cols})`}</p></div>`;
    }
  }
}

/**
 * Serialises the modular block array into clean semantic HTML.
 * If every block is empty, returns `""` so blank draft validation still works.
 */
export function blocksToHtml(blocks: PageBlock[]): string {
  const nonEmpty = blocks.filter((b) => !isBlockEmpty(b));
  if (nonEmpty.length === 0) return "";
  return nonEmpty.map((block) => renderSingleBlockHtml(block, true)).join("\n");
}

function unescapeAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export type PageContentSegment =
  | { kind: "html"; html: string }
  | { kind: "simple_product"; block: PageBlock }
  | { kind: "layout"; block: PageBlock };

/**
 * Splits sanitised page HTML into static rich-text segments and interactive
 * `simple_product` / `layout` blocks so `PageArticle` can mount them cleanly.
 */
export function extractContentSegments(sanitizedHtml: string): PageContentSegment[] {
  if (
    !sanitizedHtml ||
    (!sanitizedHtml.includes('data-block-type="simple_product"') &&
      !sanitizedHtml.includes('data-block-type="layout"'))
  ) {
    return sanitizedHtml ? [{ kind: "html", html: sanitizedHtml }] : [];
  }

  const segments: PageContentSegment[] = [];
  const re = /<div\b[^>]*data-block-type="(?:simple_product|layout)"[^>]*>[\s\S]*?<\/div>/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(sanitizedHtml)) !== null) {
    const before = sanitizedHtml.slice(lastIdx, match.index).trim();
    if (before) segments.push({ kind: "html", html: before });

    const blockEl = match[0];
    const jsonMatch = blockEl.match(/data-block-json="([^"]+)"/i);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(jsonMatch[1])) as PageBlock;
        if (parsed && parsed.type === "simple_product") {
          segments.push({ kind: "simple_product", block: parsed });
        } else if (parsed && parsed.type === "layout") {
          const rows = Math.max(1, Math.min(12, parsed.layoutRows ?? 1));
          const cols = Math.max(1, Math.min(6, parsed.layoutCols ?? 2));
          segments.push({
            kind: "layout",
            block: {
              ...parsed,
              layoutRows: rows,
              layoutCols: cols,
              layoutCells: normalizeLayoutCells(rows, cols, parsed.layoutCells),
            },
          });
        } else {
          segments.push({ kind: "html", html: blockEl });
        }
      } catch {
        segments.push({ kind: "html", html: blockEl });
      }
    } else {
      segments.push({ kind: "html", html: blockEl });
    }
    lastIdx = match.index + blockEl.length;
  }

  const tail = sanitizedHtml.slice(lastIdx).trim();
  if (tail) segments.push({ kind: "html", html: tail });

  return segments;
}

/**
 * Parses saved HTML (either block-annotated HTML or legacy TipTap HTML) into
 * an array of `PageBlock` objects for the Block Editor.
 */
export function htmlToBlocks(html: string): PageBlock[] {
  if (!html || !html.trim()) return defaultInitialBlocks();

  const validTypes = new Set<string>(BLOCK_DEFINITIONS.map((d) => d.type));
  const parsed: PageBlock[] = [];
  const jsonAttrRe = /data-block-json="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = jsonAttrRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(unescapeAttr(match[1])) as PageBlock;
      if (obj && typeof obj === "object" && obj.type && obj.id && validTypes.has(obj.type)) {
        if (obj.type === "image") {
          const l = obj.imageLayout as string | undefined;
          if (l === "standard") obj.imageLayout = "custom";
          else if (l === "wide" || !l) obj.imageLayout = "full";
        }
        if (obj.type === "layout") {
          const rows = Math.max(1, Math.min(12, obj.layoutRows ?? 1));
          const cols = Math.max(1, Math.min(6, obj.layoutCols ?? 2));
          obj.layoutRows = rows;
          obj.layoutCols = cols;
          obj.layoutCells = normalizeLayoutCells(rows, cols, obj.layoutCells);
        }
        parsed.push(obj);
      }
    } catch {
      // ignore malformed JSON attribute and fall back below
    }
  }
  if (parsed.length > 0) return parsed;

  // Fallback parser for legacy HTML created before the Block Editor
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const children = Array.from(doc.body.children);
      let idx = 1;
      for (const el of children) {
        const tag = el.tagName.toLowerCase();
        const id = `b-${idx++}`;
        if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
          parsed.push(
            createBlock("heading", id, {
              level: tag as HeadingLevel,
              html: el.innerHTML,
            }),
          );
        } else if (tag === "p") {
          const img = el.querySelector("img");
          if (img && el.textContent?.trim() === "") {
            parsed.push(
              createBlock("image", id, {
                src: img.getAttribute("src") ?? "",
                alt: img.getAttribute("alt") ?? "",
                mediaId: img.getAttribute("data-media-id") ?? null,
              }),
            );
          } else {
            parsed.push(createBlock("paragraph", id, { html: el.innerHTML }));
          }
        } else if (tag === "blockquote") {
          parsed.push(createBlock("quote", id, { html: el.innerHTML }));
        } else if (tag === "ul" || tag === "ol") {
          const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => li.innerHTML);
          parsed.push(
            createBlock("list", id, {
              listStyle: tag === "ol" ? "ordered" : "bullet",
              items: items.length ? items : [""],
            }),
          );
        } else if (tag === "figure" || tag === "img") {
          const img = tag === "img" ? el : el.querySelector("img");
          const cap = el.querySelector("figcaption");
          if (img) {
            parsed.push(
              createBlock("image", id, {
                src: img.getAttribute("src") ?? "",
                alt: img.getAttribute("alt") ?? "",
                mediaId: img.getAttribute("data-media-id") ?? null,
                caption: cap?.textContent ?? "",
              }),
            );
          }
        } else if (tag === "hr") {
          parsed.push(createBlock("divider", id));
        } else {
          parsed.push(createBlock("paragraph", id, { html: el.innerHTML }));
        }
      }
      if (parsed.length > 0) return parsed;
    } catch {
      // ignore
    }
  }

  return [createBlock("paragraph", "b-1", { html })];
}
