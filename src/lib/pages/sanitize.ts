import "server-only";
import sanitizeHtml from "sanitize-html";
import { isUuid } from "@/lib/media/shared";

/*
 * Rich-text content is stored *and* rendered through this allow-list, so a
 * compromised editor payload (or a hand-crafted request) can never put
 * scripts, event handlers, iframes or javascript: URLs on the storefront.
 * The list mirrors what the editor can produce (Tiptap StarterKit + text
 * alignment, images from the Media Library, tables).
 */

const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup", "code", "kbd",
  "a",
  "ul", "ol", "li",
  "blockquote", "pre",
  "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
  "span", "div",
];

const TEXT_ALIGN = [/^left$/, /^center$/, /^right$/, /^justify$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "class"],
    img: ["src", "alt", "title", "width", "height", "loading", "data-media-id", "class"],
    td: ["colspan", "rowspan", "colwidth"],
    th: ["colspan", "rowspan", "colwidth"],
    ol: ["start", "type", "data-block-id", "data-block-type", "data-block-json", "class"],
    ul: ["data-block-id", "data-block-type", "data-block-json", "class"],
    "*": ["style", "data-block-id", "data-block-type", "data-block-json", "class"],
  },
  allowedClasses: {
    "*": [/^page-[a-z0-9-]+$/, /^language-[a-z0-9-]+$/],
  },
  allowedStyles: {
    "*": {
      "text-align": TEXT_ALIGN,
      color: [
        /^#[0-9a-fA-F]{3,8}$/,
        /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
        /^var\(--primary\)$/,
      ],
    },
    img: {
      width: [/^\d{1,5}px$/, /^100%$/],
      height: [/^\d{1,5}px$/, /^auto$/],
      "max-width": [/^\d{1,5}px$/, /^100%$/],
      "max-height": [/^\d{1,5}px$/],
      "object-fit": [/^cover$/, /^contain$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  // keep relative links (/shop, #section) – they are same-site by definition
  allowedIframeHostnames: [],
  disallowedTagsMode: "discard",
  // scripts/styles are dropped *with* their text so nothing leaks into the copy
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "template"],
  transformTags: {
    a: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (out.target === "_blank") out.rel = "noopener noreferrer";
      else {
        delete out.target;
        delete out.rel;
      }
      return { tagName, attribs: out };
    },
    img: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (!out.alt) out.alt = "";
      out.loading = "lazy";
      if (out["data-media-id"] && !isUuid(out["data-media-id"])) delete out["data-media-id"];
      for (const dim of ["width", "height"] as const) {
        if (out[dim] && !/^\d{1,5}$/.test(out[dim])) delete out[dim];
      }
      return { tagName, attribs: out };
    },
  },
};

/**
 * Cleans editor HTML for storage and for rendering (defence in depth – it runs
 * on both ends). Headings deeper than h4 are flattened to h4 so the page
 * outline stays sane (the page title is the only h1).
 */
export function sanitizePageHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html.replace(/<h[56]\b/gi, "<h4").replace(/<\/h[56]>/gi, "</h4>"), OPTIONS).trim();
}

/** Media Library ids referenced by <img data-media-id="…"> inside the content. */
export function mediaIdsFromHtml(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/data-media-id="([0-9a-f-]{36})"/gi)) if (isUuid(match[1])) ids.add(match[1].toLowerCase());
  return [...ids];
}

/** True when the content has no visible text, image, table, divider or product/layout block (an empty editor). */
export function isBlankHtml(html: string): boolean {
  return (
    !/<(img|hr|table|iframe)\b/i.test(html) &&
    !/data-block-type="(?:simple_product|layout)"/i.test(html) &&
    sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\s/g, "") === ""
  );
}
