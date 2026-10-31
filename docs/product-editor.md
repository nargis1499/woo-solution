# Product editor

## Fields and presentation

- Product name appears first, followed by product type and brand. Field labels and section headings use Lucide icons and semantic theme colors.
- Short description remains plain text for product cards and the top of the product page.
- Detailed content uses the same `useBlockEditorState`, `BlockEditorCanvas` and `BlockSettingsInspector` as pages/posts. Simple-product and layout blocks use live storefront product data.
- The shared `SeoSettings` component supplies the search preview, SEO title/description, canonical URL, index/follow toggles, social title/description and Media Library/external share image.

## Pricing

Cost is optional, non-negative, in the store's displayed currency. Storage uses base USD micros, like existing prices. Untouched costs retain their exact stored micros when display rounding would otherwise lose precision.

Gross profit per unit = effective selling price − unit cost. The sale price is effective when present; otherwise the regular price is used. Margin = profit / selling price × 100. Zero selling price yields an unavailable margin, not a division-by-zero percentage. Missing/invalid input yields an empty calculation rather than invented zero costs. This is before fees, taxes and shipping.

Variable products use the common product-level unit cost against each enabled variation's price and display a profit/margin range. This is not per-variation cost accounting.

**Cost prices are stored in `product_costs`, not `products`.** The public product API cannot expose them through `select *`. Anonymous users have no privileges; authenticated users are constrained by admin-only RLS. Only the admin product loader joins costs into the form's read model.

## Stock management

The global ecommerce stock switch is now the initial default for new products. Existing products retain an explicit selection, and a product can be tracked even if the global default is off, or untracked while it is on. The database insert trigger also supplies the global default when an insert omits the flag.

Disabling product tracking hides simple and variation stock controls. Saves preserve existing stored quantities; new untracked items start at zero without becoming unavailable. Product cards, block cards, detail pages, cart additions, Schema.org availability and Nemesis inventory analysis honor the product flag. Inventory signals and low-stock filters exclude untracked products, rather than treating their stored zero as a stockout.

Checkout reads the flag per cart line and records `order_items.stock_deducted`. Cancellation/reopening uses this snapshot, not whatever stock setting happens to be selected later. Repeated lines for the same product/variation are summed when stock is restored or deducted. Historical lines were backfilled from the stock configuration at migration time: historic global-switch changes cannot be reconstructed retrospectively.

## Content, media and SEO

HTML is sanitized on save and again during server rendering. The body is present in the initial product-page HTML; it is not fetched client-side or hidden behind an unmounted tab. Existing block metadata is retained until the renderer extracts interactive blocks, then editor attributes are removed and body h1 headings demoted.

`product_content_media` tracks embedded Media Library images; `media_usage` also includes detailed content and product social images so the library recognizes these usages. Missing/trashed library images are rejected on save.

Metadata uses product SEO overrides, then existing short-description/content/name fallbacks. Canonical, robots, Open Graph and Twitter overrides are applied; noindex products are excluded from the sitemap. Product JSON-LD uses per-product stock availability and the configured canonical URL. Public product reads never load private costs.

## Migration and verification

Repository migration: `supabase/migrations/20261050000000_product_editor.sql`.
Applied to the connected Supabase project as migration `20261031010248` (`product_editor`). The checkout patch asserts expected function fragments and the migration rolls back if they differ. Database metadata confirmed new fields, cost RLS, no anonymous cost-table SELECT privilege, and updated checkout/cancellation functions.

Static verification: ESLint and TypeScript. No test suites or production checkout/product-save exercises were run, following the user's earlier no-test instruction. No build was run.
