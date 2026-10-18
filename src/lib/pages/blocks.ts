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
  | "heading"
  | "paragraph"
  | "callout"
  | "image"
  | "cta"
  | "list"
  | "quote"
  | "divider";

export type HeadingLevel = "h1" | "h2" | "h3" | "h4";
export type TextAlign = "left" | "center" | "right";
export type ParagraphVariant = "normal" | "lead" | "muted";
export type CalloutTone = "info" | "success" | "warning" | "danger";
export type ImageLayout = "wide" | "full" | "custom";
export type CtaVariant = "primary" | "secondary" | "outline";
export type ListStyle = "bullet" | "ordered";
export type DividerStyle = "solid" | "dashed" | "dots";

export type PageBlock = {
  id: string;
  type: BlockType;
  /** Rich inline HTML for heading, paragraph, callout, quote */
  html?: string;
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

export function createBlock(type: BlockType, id: string, overrides?: Partial<PageBlock>): PageBlock {
  const base: PageBlock = { id, type };
  switch (type) {
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
        imageLayout: "wide",
        imageWidth: 800,
        imageHeight: 450,
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
    case "heading":
    case "paragraph":
      return stripTags(block.html ?? "") === "";
    case "callout":
      return stripTags(block.html ?? "") === "" && !(block.calloutTitle ?? "").trim();
    case "quote":
      return stripTags(block.html ?? "") === "" && !(block.quoteAuthor ?? "").trim();
    case "image":
      return !(block.src ?? "").trim();
    case "cta":
      return !(block.buttonText ?? "").trim() && !(block.ctaHeading ?? "").trim();
    case "list":
      return !(block.items ?? []).some((item) => stripTags(item) !== "");
    case "divider":
      return false;
  }
}

/**
 * Serialises the modular block array into clean semantic HTML.
 * If every block is empty, returns `""` so blank draft validation still works.
 */
export function blocksToHtml(blocks: PageBlock[]): string {
  const nonEmpty = blocks.filter((b) => !isBlockEmpty(b));
  if (nonEmpty.length === 0) return "";

  return nonEmpty
    .map((block) => {
      const meta = escapeAttr(JSON.stringify(block));
      const alignStyle =
        block.align && block.align !== "left" ? ` style="text-align: ${block.align}"` : "";

      switch (block.type) {
        case "heading": {
          const tag = block.level && /^h[1-4]$/.test(block.level) ? block.level : "h2";
          return `<${tag} data-block-id="${escapeAttr(block.id)}" data-block-type="heading" data-block-json="${meta}"${alignStyle}>${block.html ?? ""}</${tag}>`;
        }
        case "paragraph": {
          const cls =
            block.variant === "lead"
              ? ' class="page-block-lead"'
              : block.variant === "muted"
                ? ' class="page-block-muted"'
                : "";
          return `<p data-block-id="${escapeAttr(block.id)}" data-block-type="paragraph" data-block-json="${meta}"${cls}${alignStyle}>${block.html ?? ""}</p>`;
        }
        case "callout": {
          const tone = block.tone ?? "info";
          const titleHtml = block.calloutTitle?.trim()
            ? `<p class="page-callout-title"><strong>${escapeHtml(block.calloutTitle.trim())}</strong></p>`
            : "";
          return `<div class="page-block-callout page-callout-${escapeAttr(tone)}" data-block-id="${escapeAttr(block.id)}" data-block-type="callout" data-block-json="${meta}">${titleHtml}<div class="page-callout-body">${block.html ?? ""}</div></div>`;
        }
        case "image": {
          const rawLayout = block.imageLayout;
          const layout: ImageLayout =
            rawLayout === "custom" || rawLayout === "full" || rawLayout === "wide"
              ? rawLayout
              : "wide";
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
          const dimAttrs = `${w ? ` width="${w}"` : ""}${h ? ` height="${h}"` : ""}`;
          const styleParts: string[] = [];
          if (layout === "custom") {
            if (w) styleParts.push(`width: ${w}px`);
            if (h) styleParts.push(`height: ${h}px`);
            styleParts.push("object-fit: cover");
          }
          const imgStyle = styleParts.length ? ` style="${styleParts.join("; ")}"` : "";
          const captionHtml = block.caption?.trim()
            ? `<figcaption>${escapeHtml(block.caption.trim())}</figcaption>`
            : "";
          return `<figure class="page-block-image page-image-${escapeAttr(layout)}" data-block-id="${escapeAttr(block.id)}" data-block-type="image" data-block-json="${meta}"><img src="${src}" alt="${alt}"${mediaAttr}${dimAttrs}${imgStyle} loading="lazy" />${captionHtml}</figure>`;
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
          return `<div class="page-block-cta page-cta-${escapeAttr(variant)}" data-block-id="${escapeAttr(block.id)}" data-block-type="cta" data-block-json="${meta}"${alignStyle}>${headingHtml}${subtextHtml}<p class="page-cta-action"><a href="${href}" class="page-cta-button page-cta-button-${escapeAttr(variant)}"${targetAttr}>${label}</a></p></div>`;
        }
        case "list": {
          const tag = block.listStyle === "ordered" ? "ol" : "ul";
          const items = (block.items ?? [])
            .filter((item) => stripTags(item) !== "")
            .map((item) => `<li>${item}</li>`)
            .join("");
          return `<${tag} data-block-id="${escapeAttr(block.id)}" data-block-type="list" data-block-json="${meta}">${items}</${tag}>`;
        }
        case "quote": {
          const authorHtml = block.quoteAuthor?.trim()
            ? `<figcaption class="page-quote-author">— ${escapeHtml(block.quoteAuthor.trim())}</figcaption>`
            : "";
          return `<blockquote class="page-block-quote" data-block-id="${escapeAttr(block.id)}" data-block-type="quote" data-block-json="${meta}"${alignStyle}><p>${block.html ?? ""}</p>${authorHtml}</blockquote>`;
        }
        case "divider": {
          const style = block.dividerStyle ?? "solid";
          return `<hr class="page-block-divider page-divider-${escapeAttr(style)}" data-block-id="${escapeAttr(block.id)}" data-block-type="divider" data-block-json="${meta}" />`;
        }
      }
    })
    .join("\n");
}

function unescapeAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
        if (obj.type === "image" && (obj.imageLayout as string) === "standard") {
          obj.imageLayout = "custom";
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
