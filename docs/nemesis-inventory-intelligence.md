# Nemesis: Inventory Intelligence

## Capability groups

`AGENT_TOOL_GROUPS` in `src/lib/ai/tools.ts` groups the catalog into:

- Inventory Intelligence (new analysis and signal-based status previews)
- Inventory Operations (existing live inventory and stock/status tools)
- Store Analytics
- Pricing & Promotions
- Content & SEO
- Order Operations

Both cloud providers and browser-direct Ollama receive the same flattened catalog today. The registry is an extension point for future selective tool loading, per-group budgets, permissions, and routing; it does not yet add another model/router call or background agent.

## Modules

- `src/lib/ai/inventory/intelligence.ts`: pure deterministic calculations, defaults, validation, report types. No model or database dependency.
- `src/lib/ai/inventory/tools.ts`: admin-guarded, bounded paginated Supabase reads, tool schemas, filtering, and approval-plan construction.
- `src/components/admin/ai/inventory-intelligence-card.tsx`: theme-adaptive report cards with product/SKU metrics, signal counts, calculation details and data-quality warnings.
- `executeApprovedPlan()` in `src/lib/ai/tools.ts`: direct, version-checked status updates after approval, without another LLM call.

## What it does

1. **Depletion**: current sellable stock divided by planning sales/day, with estimated date and a configurable risk horizon.
2. **Dead inventory**: stocked products/SKUs at least `deadDays` old with zero qualifying sales during that period. New listings and out-of-stock items are not called dead.
3. **Overstock**: inventory exceeding `overstockDays` of observed mean demand, with excess units. Zero-velocity items are assessed as dead inventory rather than claiming infinite coverage.
4. **Bulk status**: preview active/draft changes for a signal or explicit parent product IDs. Always requires admin approval, even if global auto-apply is enabled. Does not alter stock counts.
5. **Sales spikes**: daily sales during the recent window compared with the preceding, non-overlapping baseline, plus a minimum-unit threshold. Requires enough product age to observe both windows. A zero baseline is labeled new demand, not infinite percentage growth.
6. **Suggested reorder**: reorder point = ceil(planning rate × (lead time + safety)). Target = ceil(planning rate × (lead time + safety + review cycle)). Suggest max(0, target − current stock) only when stock is at/below reorder point. Detected spikes use the higher of recent and mean sales/day for planning.

## Defaults and controls

| Setting | Default |
|---|---:|
| Sales velocity window | 30 days |
| No-sales dead inventory window | 90 days |
| Overstock coverage | 90 days |
| Depletion warning horizon | 14 days |
| Supplier lead-time assumption | 14 days |
| Safety buffer | 7 days |
| Review cycle | 14 days |
| Spike recent/baseline windows | 7 / 28 days |
| Spike multiplier / minimum recent units | 2× / 5 units |
| Display/approval batch size | 20, configurable up to 50 |

All tool inputs have bounded numeric validation. Users can specify actual supplier lead times, category, name/SKU, active/draft/all status and signal. Analysis defaults to active products; status previews default to all so publishing a draft is possible. Exact category slugs do not fuzzy-match into another category. Status preview filters and calculations are recomputed from live data, not trusted from a model-generated report.

## Data and safeguards

- Uses order creation timestamps in UTC, completed orders or paid processing orders; excludes pending/cancelled/refunded orders. Unpaid processing orders are ignored. Completed orders are treated as fulfilled demand, even if their payment field is unpaid.
- Loads sufficient history for velocity, dead-stock and both spike windows. Product age shortens velocity exposure for new listings (minimum one observed day), and limited evidence is labeled.
- Active variation stock is summed for parent variable products; active SKUs also get individual rows. Parent and SKU totals **overlap**. Bulk signal actions use parent rows only: a dead SKU cannot by itself hide a selling parent product.
- Legacy variable-product sales without variation IDs remain in parent totals. SKU-level signals/reorders for affected products are suppressed because allocating these sales would be a guess.
- Stock-derived signals are disabled per untracked product; sales spikes can still be inspected. Products can override the global stock-management default.
- Scans are explicitly paginated and capped at 5,000 products and 10,000 eligible-status orders. Hitting either cap marks the report incomplete, suppresses signals/reorders, and blocks inventory status previews. This avoids presenting a partial-history forecast as a complete forecast. Larger stores should move aggregation into a dedicated database RPC/background snapshot; that is a future optimization, not silently approximated here.
- Approval updates only product publication status. Product and variation version snapshots detect changes after preview generation. Replayed approvals are rejected by the product version check. Successful writes refresh storefront caches.
- Neither recommendation tools nor bulk status tools create purchase orders, mark stock as received, or automatically set stock to reorder targets. The existing explicit stock-update tool remains separate.

## Limitations

This is a historical sales-velocity heuristic, **not trained machine learning or guaranteed forecasting**. There is no historic stockout exposure, supplier/inbound order model, automatic seasonality correction, or partial-return quantity ledger. Reorders assume zero inbound stock and are suggestions. "Established sales history" means at least 14 days of product age and 5 units sold, not a statistical confidence interval. Forecast dates are omitted for zero/unknown velocity and extremely long coverage. Reports run on demand inside a chat turn; no cron, notifications, scheduled purchasing or persisted forecast history is introduced.

## Example prompts

- “Predict which active products will run out in the next 14 days using the last 30 days of sales.”
- “Find stocked products with no sales for 90 days.”
- “Which products have more than 120 days of stock?”
- “Detect sales spikes over the last 7 days compared with the previous 28 days.”
- “Suggest reorder quantities with a 21-day supplier lead time, 7 safety days and a 14-day review cycle.”
- “Prepare approval to move dead inventory in category `accessories` to draft.”
- “Publish these specific draft product IDs; show the preview first.”

## Verification

Regression cases are provided in `tests/inventory-intelligence.test.mjs`. Existing content-tool test mocks were updated for the modular import. No test suites were executed for this change, following the user's instruction. Lint and TypeScript checks are static verification only.
