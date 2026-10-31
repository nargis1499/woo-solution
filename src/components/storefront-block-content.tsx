import { getSimpleProductsByIds } from "@/lib/data/products";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import { extractContentSegments } from "@/lib/pages/blocks";
import { sanitizePageHtml } from "@/lib/pages/sanitize";
import { getSiteSettings } from "@/lib/site-settings";
import { cleanStorefrontHtml, StorefrontLayoutBlock } from "./page-article";
import { SimpleProductBlockCard } from "./simple-product-block-card";

/** Server-rendered block content: all copy is in the initial HTML, including layout blocks. */
export async function StorefrontBlockContent({ content }: { content: string }) {
  const segments = extractContentSegments(sanitizePageHtml(content));
  const ids = new Set<string>();
  for (const segment of segments) {
    if (segment.kind === "simple_product" && segment.block.productId) ids.add(segment.block.productId);
    if (segment.kind === "layout") for (const cell of segment.block.layoutCells ?? []) for (const child of cell) {
      if (child.type === "simple_product" && child.productId) ids.add(child.productId);
    }
  }
  const [products, settings, canEdit] = await Promise.all([
    ids.size ? getSimpleProductsByIds([...ids]) : Promise.resolve([]),
    getSiteSettings(),
    ids.size ? isCurrentUserAdmin() : Promise.resolve(false),
  ]);
  const productsById = new Map(products.map((p) => [p.id, p]));
  return <div className="space-y-6" data-testid="product-detailed-content">{segments.map((seg, i) => {
    if (seg.kind === "html") return <div key={i} className="rich-text rich-text-lg" dangerouslySetInnerHTML={{ __html: cleanStorefrontHtml(seg.html) }} />;
    if (seg.kind === "simple_product") return <SimpleProductBlockCard key={i} block={seg.block} product={productsById.get(seg.block.productId || "") ?? null} manageStock={settings.manage_stock} canEdit={canEdit} />;
    return <StorefrontLayoutBlock key={i} block={seg.block} productsById={productsById} manageStock={settings.manage_stock} canEdit={canEdit} />;
  })}</div>;
}
