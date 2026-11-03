# AI page builder

Every new/edit CMS page has a persistent **Build with AI** panel beside the visual block canvas on desktop (stacked on smaller screens). No database migration is needed. Existing manual editing, title, slug, featured image, tags, SEO settings and explicit publishing remain unchanged.

## Admin workflow

1. Enable/configure a provider and primary model in **Settings → AI**.
2. Open a page and describe the desired sections in the right-hand **Build with AI** panel. Include verified business facts, exact links and the language to use. Ask for a small number of sections, especially with economy mode or a small local model.
3. **Generate preview** does not change the editor, save a draft or publish anything. Review the proposed content, images, heading structure and links. Generation can be cancelled; stale/cancelled responses cannot apply themselves.
4. Suggested sections appear as thumbnail cards; expand **Inspect full design preview** for the server-sanitized preview. **Apply sections** appends editable blocks by default. **Replace page content** requires confirmation when content exists. Neither mode changes metadata or the shared site shell.
5. The canvas displays visual section cards with **Edit / Done**, **Duplicate**, **Delete**, drag handles and keyboard-accessible move buttons. Edit opens the existing detailed editor for that section; click a section title to open its inspector. Visual cards use safe React text summaries rather than injecting saved HTML, so inline rich formatting may be simplified. The saved-page Preview remains the storefront reference. Drag handles support pointer and keyboard sorting. Other editors keep their existing canvas presentation. Layouts have **Section appearance** (plain, soft, accent, contrast) and **Column appearance** (plain/cards). These settings also work for manually created layouts. Changing advanced manual controls (custom image dimensions, callout tone or divider style) switches that individual block back to the standard renderer so those existing controls continue to work. Replacing an image clears stale intrinsic dimensions.
6. **Undo last apply** restores the pre-apply document only while the body still matches the just-applied document. It is disabled after further body edits to avoid discarding newer work. One local undo snapshot is kept; this is not persistent revision history.
7. Use **Save draft**, **Publish** or **Update** in the editor header explicitly. Compact title, slug and featured-image controls stay above **Blocks / Page settings** tabs. Tags, SEO, page details, live link and page deletion are under **Page settings**. Both tab panels stay mounted so tab changes do not lose drafts or omit form fields during saving. The AI status reports configuration readiness, not an unperformed live connectivity check. Applying AI to an already published page does not change the live page until Update.

## Supported designs and boundaries

AI composes the existing layout, heading, paragraph, callout, image, simple-product, CTA, list, quote and divider blocks. This can produce heroes, feature cards, banners, stories, static FAQ pairs, steps, galleries and collection/product sections. It does not invent new executable block types.

- Layouts: one row, 1–4 columns, no nested layouts, 1–8 children per column.
- Maximum 12 top-level blocks, 48 blocks total, 60 KB model JSON and 150 KB serialized generated content. The existing 200,000-character whole-page save limit also applies on append/replace.
- Text, list lengths, enum choices, links and object properties are validated server-side. Unknown block types/properties and arbitrary classes, CSS, HTML/JSX and scripts are not accepted as design instructions. Text fields are escaped as plain text, never executed.
- Only up to 12 recent, non-trashed library images and 12 recent active catalog products are supplied as candidates. Only simple products are supported. Unsupported or no-longer-available references fail validation rather than turning into invented images/products. Add other assets/products manually with existing controls.
- Image URLs and dimensions come from the library; large/medium renditions are preferred when present. Images include alt text, dimensions when known and lazy loading. The existing featured image remains the high-priority page image. No image generation is performed.
- Product names/prices/stock come from catalog records, not the model. Generated product cards have fabricated sample ratings disabled. The AI preview uses a labeled static catalog-product placeholder; the applied editor/storefront use the existing live product component and cart controls.
- Quotes and claims still need human review: validation cannot prove that a testimonial, figure or business statement is true.
- No generated forms, custom JavaScript, carousels, arbitrary CSS, external dependencies, global header/footer edits, automatic schema markup or metadata changes. FAQ content is static, not an accordion.

## Providers and local Ollama

Hosted providers and server-reachable Ollama tunnels reuse the existing universal provider client and stored server-side credentials. Optional caller cancellation/deadlines and output budgets were added without changing defaults for other AI callers.

Browser-direct Ollama intentionally calls the admin's configured local machine from their browser, matching the existing connection mode. The server returns only the transport URL, model, bounded prompt and inference options—never stored API keys. Local output must return to the authenticated server for the same validation and sanitized preview before it can enter the editor. Configure Ollama CORS for the admin site's origin; browser local-network permissions/mixed-content restrictions may require the HTTPS tunnel mode. Browser mode does not send a stored bearer token; use tunnel mode for authenticated endpoints.

Generation has a 150-second provider deadline (165 seconds including browser round trips), explicit cancellation, bounded input/output budgets (with approximate context headroom checks for Ollama) and a best-effort per-instance 15-second generation cooldown per admin. This cooldown is not a distributed rate limiter; provider quotas remain authoritative across replicas. Provider failures, timeouts, malformed/truncated JSON or invalid designs leave existing content unchanged. There is no automatic repair loop or unbounded retry; simplify the prompt, adjust the configured token budget or retry explicitly. Existing provider overload fallback is retained.

## Data handling and security

The model receives the admin prompt, current page title, brand tone/language, and the bounded candidate image names/alt text and product IDs/names. Existing page body, SEO metadata and customer/order data are not included. Only request generation when that disclosure to the configured provider is appropriate. Hosted calls use the existing diagnostic logging infrastructure, subject to its retention controls.

`POST /api/nemesis/ai/page-design` is authenticated and admin-only for both generation and browser-output validation, checks request origin, bounds request bodies and returns private/no-store responses. It has no page write capability or agent tools. All output is projected into a fixed schema, assigned new IDs and serialized through the existing save flow. No model property bag is spread into a block.

`src/lib/pages/block-design.ts` owns literal, precompiled Tailwind templates and the exact utility allow-list. The model chooses presets rather than supplying utility strings. Existing legacy rich-text sanitation remains in place; general Tailwind/arbitrary values, style tags and scripts are not newly allowed. Existing rich-text inline styles remain supported for manual/legacy pages; the AI-generated templates themselves contain no inline styles. Images and text are sanitized on storage and storefront rendering as before.

## Performance and SEO

Generation happens only on explicit admin requests, never during visitor rendering. Saved block data round-trips through `pages.content` and the normal editor. Content is server-rendered, with the existing live product component providing the trusted interactive behavior. Static layouts need no AI SDK, browser Tailwind compiler or client layout renderer. Generated blocks use semantic headings, paragraphs, lists, links, quotes and images; generated headings start at h2 because the page template owns h1.

Existing canonical URLs, sitemap inclusion, robots settings, homepage routing, metadata and invalidation remain owned by the existing CMS. No model-written structured data is injected. Validation badges are structural checks, not SEO scoring, accessibility certification or a guarantee of rankings/Core Web Vitals. Review copy quality, link targets, alt text, heading order and actual page performance before publishing.

## Verification for this change

Static TypeScript, ESLint, production build and whitespace checks only. No tests/test suites, browser sessions, screenshots, live provider generations, live settings mutations or authenticated production saves were performed. A configured model and authenticated admin are required for live generation.
