# Reusable product and stock queries

Nemesis uses **AI interpretation → a whitelisted structured query → deterministic read-only execution**. There is no sentence-specific function, paid intent-classification request, read-verb routing gate or model-generated SQL. `query_inventory` keeps its registered name for compatibility and uses the shared lazy tool catalog on cloud/native, prompt-based and browser Ollama paths. General requests retain discovery access; conservative standalone-report shortcuts still exist for supported intelligence reports.

Install `supabase/migrations/20261058000000_product_queries.sql` once on new client databases, after the existing migrations. It adds `nemesis_products_read(jsonb)` and its private comparison helper; no products, quantities or prices are changed. The connected project received this migration during implementation.

## One contract, many requests

These are structured examples, **not wording patterns**:

| Administrator intent | `query_inventory` arguments |
|---|---|
| Bring me some products with stock greater than 20 | `{"stock":{"gt":20}}` |
| At least 20, but fewer than 50 | `{"stock":{"gte":20,"lt":50}}` |
| Exactly 20 / anything other than 20 | `{"stock":{"eq":20}}` / `{"stock":{"ne":20}}` |
| Out of stock, published | `{"stockStatus":"out_of_stock","status":"active"}` |
| Stock below 5 OR above 100 | `{"anyOf":[{"stock":{"lt":5}},{"stock":{"gt":100}}]}` |
| Stock >20 AND price ≤100 BDT | `{"stock":{"gt":20},"price":{"lte":100},"currency":"BDT"}` |
| Cheapest featured products currently discounted | `{"featured":true,"onSale":true,"sortBy":"price","sortDirection":"asc"}` |
| Highest-stock purchasable SKUs | `{"scope":"skus","sortBy":"stock","sortDirection":"desc"}` |
| Next 10 results | Same filters with `"page":2,"limit":10`; UI pagination makes **no model calls** |

All root filters combine with AND. `anyOf` accepts 1–10 stock/price groups combined with OR; comparisons inside each group combine with AND. OR across category values uses `categorySlugs`; row IDs use `ids`. Arbitrary nested Boolean/text expressions, regex, fuzzy category matching and arbitrary SQL are **not** supported. Ask for clarification rather than silently approximating unsupported requirements (for example, undefined “healthy stock”).

Numeric operators: `gt`, `gte`, `lt`, `lte`, `eq`, `ne`. Legacy `minStock`/`maxStock` (inclusive), `outOfStockOnly` (=0) and server-side `minPrice`/`maxPrice` aliases normalize into comparisons. Contradictory ranges, invalid types/IDs, unknown fields/operators, empty/oversized lists and unsupported enums fail rather than dropping a selection. Omitted/null optional parameters use defaults; supplied empty text is rejected.

Other filters: parent publication `status` (active/draft/all), `variationStatus`, exact brand/SKU, product type, featured/on-sale flags, literal name/search substrings, category name/slug/UUID, row/parent IDs and creation/update dates. Category names must resolve uniquely; unknown categories error, never become “all categories.” Category IDs/slugs are exact. Search is literal, not a LIKE pattern or instruction. Dates have inclusive `From` and exclusive `To` bounds; the agent defaults to UTC unless the administrator specifies a timezone.

Sort by name, stock, displayed price, creation or update date, ascending/descending. Missing values sort last in either direction; UUID breaks ties. Pages default to 10 rows, max 50; page numbers 1–10,000. Totals still cover all matches beyond the page window. These are current catalog reads, not historical stock reconstruction. Live pagination refreshes counts/rows and can shift during concurrent edits.

## Scope and financial/stock semantics

- **products** (default): one row per parent product. Simple stock/price come from that product. Variable stock sums **active** variations and price is the minimum active variation price. No active variations means zero tracked units and an unknown/null price, not a stale parent price. On-sale means any active variation has compare-at price above its current price; the cheapest option is not necessarily the discounted one. Product search/exact SKU can match an active variation and then returns the parent aggregate.
- **variations**: individual options of variable parents only; active by default. `variationStatus` can select inactive/all options. Parent `status` remains independent, so an active option on a draft parent is not reported as a published product.
- **skus**: simple products plus individual variations, excluding variable parents. Use this for a SKU's own quantity or a non-double-counted all-SKU total. Variation status applies to options, not simple products. Options without a SKU are still included and retain their UUID identity.
- Do not add totals from overlapping product/variation/SKU reports. The chosen scope defines the counted entities and tracked unit total.
- Per-product `manage_stock` is authoritative. Untracked stock is `null`, not zero or an assumed numeric infinity. All numeric stock comparisons (including `ne`) exclude unknown quantities; `untracked` is available separately. `in_stock` is tracked >0; `out_of_stock` is tracked =0. Low stock metric means tracked 1–3.
- Prices are compared in the explicit USD/BDT currency or the current configured display currency. FX comes from settings in the same database read; the model cannot supply an exchange rate. Compare **rounded cents/poisha**, so a displayed BDT 100.00 matches `eq:100` despite micro-dollar conversion residuals. Unsupported/unconfigured BDT conversion errors instead of guessing. Model prices are preformatted; no model-side rescaling. Unknown prices do not match numeric price comparisons.

## Completeness, UI and safety

The RPC filters the **whole database before counts, metrics, sorting and pagination**. The old latest-500 scan is no longer used for `query_inventory`. Other existing tools are not silently rewritten: intelligence forecasts remain in their own tools; analytics/write-preview scan behavior is unchanged.

Cards retain loaded rows and model-free Previous/Next controls, filter/sort context, full-cohort counts and tracked-unit metrics. Only bounded row examples go back into the model context via the shared explicit projection; full UI pages and exact IDs/arguments are not truncated. The model receives matched count, page/hasMore, normalized filters, currency and cohort metrics and is told never to infer totals from samples.

The service checks admin authorization on every request, including pagination. The RPC independently checks the authenticated administrator, is STABLE/SECURITY DEFINER with a fixed search path and a 15-second timeout, and is executable only by `authenticated`. The pure fixed-operator helper is not callable by anon/authenticated directly. SQL is fixed; no dynamic SQL. No cost/private product financial fields are selected. Unsupported precision/timeouts fail rather than showing rounded unsafe quantities or partial totals.

Read filters do **not** authorize new mutations. Existing discount/status previews reject unrecognized arguments, invalid known types and unknown categories before constructing a plan, so passing `stock`, `price`, `ids` or other new read criteria cannot silently widen a write selection. New-stock/discount bounds are rejected rather than silently clamped. Existing confirmations/apply-time authorization remain unchanged; requests outside write capabilities must be explained, not converted into broader writes.

## Verification

ESLint, TypeScript no-emit, whitespace diff checks and static SQL/PL/pgSQL parsing only. Migration deployment and metadata inspection confirmed the function bodies, STABLE/security configuration and execution grants. No tests, synthetic report/tool calls, live model requests or end-to-end browser runs were performed. Natural-language/provider behavior and token savings are not runtime-measured; supported capability is not a guarantee of understanding every possible phrase.
