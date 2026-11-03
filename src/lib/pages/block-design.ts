import type { PageBlock } from "./blocks";

/** Literal utilities are scanned at build time. Models never supply class names. */
export const DESIGN_CLASSES = {
  section: {
    plain: "rounded-2xl bg-background text-foreground p-6 sm:p-10",
    soft: "rounded-2xl bg-muted text-foreground p-6 sm:p-10",
    accent: "rounded-2xl bg-primary/10 text-foreground p-6 sm:p-10",
    contrast: "rounded-2xl bg-slate-950 text-slate-50 p-6 sm:p-10",
  },
  columns: {
    1: "grid grid-cols-1",
    2: "grid grid-cols-1 md:grid-cols-2",
    3: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    5: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5",
    6: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
  },
  gap: { sm: "gap-4", md: "gap-6", lg: "gap-8" },
  valign: {
    top: "items-start",
    center: "items-center",
    stretch: "items-stretch",
  },
  cell: {
    plain: "min-w-0 space-y-4",
    card: "min-w-0 space-y-4 rounded-xl border border-current/15 p-5",
  },
  align: { left: "text-left", center: "text-center", right: "text-right" },
  heading: {
    h1: "m-0 text-inherit text-3xl font-bold tracking-tight sm:text-4xl",
    h2: "m-0 text-inherit text-3xl font-bold tracking-tight sm:text-4xl",
    h3: "m-0 text-inherit text-xl font-semibold tracking-tight",
    h4: "m-0 text-inherit text-lg font-semibold",
  },
  paragraph: {
    normal: "m-0 text-base leading-7",
    lead: "m-0 text-lg leading-8",
    muted: "m-0 text-sm leading-6 opacity-80",
  },
  button: {
    primary:
      "inline-flex rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground no-underline",
    secondary:
      "inline-flex rounded-lg bg-secondary px-5 py-3 font-semibold text-secondary-foreground no-underline",
    outline:
      "inline-flex rounded-lg border border-current text-inherit px-5 py-3 font-semibold no-underline",
  },
  stack: "space-y-4",
  image: "h-auto w-full rounded-xl object-cover",
  caption: "mt-2 text-sm opacity-80",
  callout: "rounded-xl border border-current/15 p-5 space-y-3",
  title: "m-0 text-inherit text-lg font-semibold",
  bullets: "list-disc space-y-2 pl-6",
  ordered: "list-decimal space-y-2 pl-6",
  quote: "border-l-4 border-current/30 pl-5 text-lg italic",
  divider: "my-6 border-current/20",
} as const;

export type SectionStyle = keyof typeof DESIGN_CLASSES.section;
export type CellStyle = keyof typeof DESIGN_CLASSES.cell;

// Exact allow-list only; do not permit arbitrary Tailwind or arbitrary values.
function classStrings(value: unknown): string[] {
  return typeof value === "string"
    ? value.split(/\s+/)
    : Object.values(value as Record<string, unknown>).flatMap(classStrings);
}
export const DESIGN_ALLOWED_CLASSES = [
  ...new Set(classStrings(DESIGN_CLASSES)),
];

export function sectionDesignClass(block: PageBlock): string {
  if (block.designVersion !== 1) return "";
  return (
    DESIGN_CLASSES.section[block.sectionStyle ?? "plain"] ??
    DESIGN_CLASSES.section.plain
  );
}
export function cellDesignClass(block: PageBlock): string {
  return (
    DESIGN_CLASSES.cell[block.cellStyle ?? "plain"] ?? DESIGN_CLASSES.cell.plain
  );
}
export function layoutDesignClass(block: PageBlock): string {
  const cols = Math.max(
    1,
    Math.min(6, block.layoutCols ?? 2),
  ) as keyof typeof DESIGN_CLASSES.columns;
  return [
    sectionDesignClass(block),
    DESIGN_CLASSES.columns[cols],
    DESIGN_CLASSES.gap[block.layoutGap ?? "md"],
    DESIGN_CLASSES.valign[block.layoutValign ?? "stretch"],
  ].join(" ");
}

export function escapeDesignText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Defense in depth even when called with tampered persisted metadata. */
function safeHref(raw: string): string {
  return /^(?:\/(?!\/)|#[a-zA-Z0-9_-]|https?:\/\/|mailto:|tel:)/i.test(raw) &&
    !/[\s\\\u0000-\u001f]/.test(raw)
    ? raw
    : "#";
}

/** Trusted semantic templates. Inline rich text is still sanitized at storage/render. */
export function renderDesignedBlockHtml(
  block: PageBlock,
  meta: string,
): string | null {
  if (
    block.designVersion !== 1 ||
    block.type === "layout" ||
    block.type === "simple_product"
  )
    return null;
  const d = DESIGN_CLASSES;
  const align = d.align[block.align ?? "left"] ?? d.align.left;
  const html = block.html ?? "";
  const esc = escapeDesignText;
  switch (block.type) {
    case "heading": {
      const level =
        block.level === "h3" || block.level === "h4" ? block.level : "h2";
      return `<${level}${meta} class="${d.heading[level]} ${align}">${html}</${level}>`;
    }
    case "paragraph":
      return `<p${meta} class="${d.paragraph[block.variant ?? "normal"] ?? d.paragraph.normal} ${align}">${html}</p>`;
    case "callout":
      return `<div${meta} class="${d.callout}"><p class="${d.title}">${esc(block.calloutTitle ?? "")}</p><div>${html}</div></div>`;
    case "cta":
      return `<div${meta} class="${d.stack} ${align}">${block.ctaHeading ? `<h3 class="${d.title}">${esc(block.ctaHeading)}</h3>` : ""}${block.ctaSubtext ? `<p>${esc(block.ctaSubtext)}</p>` : ""}<a class="${d.button[block.buttonVariant ?? "primary"] ?? d.button.primary}" href="${esc(safeHref(block.buttonHref ?? "#"))}"${block.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(block.buttonText ?? "Learn more")}</a></div>`;
    case "list": {
      const tag = block.listStyle === "ordered" ? "ol" : "ul";
      return `<${tag}${meta} class="${tag === "ol" ? d.ordered : d.bullets}">${(block.items ?? []).map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote${meta} class="${d.quote} ${align}"><p>${html}</p>${block.quoteAuthor ? `<p class="${d.caption}">— ${esc(block.quoteAuthor)}</p>` : ""}</blockquote>`;
    case "divider":
      return `<hr${meta} class="${d.divider}" />`;
    case "image":
      return `<figure${meta}><img class="${d.image}" src="${esc(block.src ?? "")}" alt="${esc(block.alt ?? "")}"${block.mediaId ? ` data-media-id="${esc(block.mediaId)}"` : ""}${block.imageWidth ? ` width="${Math.round(block.imageWidth)}"` : ""}${block.imageHeight ? ` height="${Math.round(block.imageHeight)}"` : ""} loading="lazy" />${block.caption ? `<figcaption class="${d.caption}">${esc(block.caption)}</figcaption>` : ""}</figure>`;
  }
}
