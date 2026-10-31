# Nemesis: Order Management Intelligence

## Entry points

Use **Order intelligence** in the Nemesis chat starter prompts, or natural language through the normal cloud/browser-direct Ollama agent. The capability group has two tools:

- `query_order_intelligence`: `search`, `detail`, `report`, `customers`, or `problems`.
- `preview_order_operations`: prepares explicit, individually selectable order operations. Read tools never write orders.

Examples:

- “Show the latest 20 completed orders.”
- “Investigate order 1001, including payment, products, variants and timeline.”
- “Find processing orders from October 1 through October 31, 2026, with at least 3 items, total above $100, and unpaid payment status.”
- “Find orders for this exact customer email containing headphones.”
- “Compare last month's paid revenue and order volume with the preceding period.”
- “Show orders needing fulfillment attention; flag processing without updates for 48 hours.”
- “Find delayed shipments and refund requests awaiting review.”
- “Show lifetime top customers, customers inactive for 120 days, and repeat-customer frequency.”
- “Which products are frequently purchased together?” (`customers`, `includeCombinations=true`)
- “Prepare cancellation of these unpaid order numbers; do not apply yet.”
- “Prepare a private internal note for order 1001.”
- “Prepare a refund request for paid order 1001 with reason …”
- “Prepare shipment for order 1001 with carrier, HTTPS tracking URL, number and estimated delivery date.”
- “Prepare an order-chat notification for these selected orders.”

## Search, investigation and reporting

Search combines exact order UUID/number, customer user ID/exact email/name-email substring, purchased product substring, status/payment/fulfillment/shipping status, inclusive start/exclusive end UTC dates, total value and summed item quantity. `refunded` maps to **payment status**, not the four-value order-status enum. Values supplied to the model tool use the store's display currency; the server converts to base USD micros. Dashboard reports explicitly label base USD rather than adding heterogeneous checkout currencies.

Search defaults to all recorded history up to a fixed request timestamp. Business reports default to the last 30 days; problem scans default to 90 days. Customer analysis defaults to all history. Admins can override these dates. Exact email/user ID or an existing order's `customerOrderId` anchor avoids guessing identities. A name search may match multiple customers; it never merges them by name.

An individual detail card includes customer/contact/address, purchased names/variants/quantities, subtotal/shipping/total, payment metadata, fulfillment/shipping/tracking, recorded timestamps and the latest 200 admin timeline events. Payment metadata embedded in legacy notes is parsed using the existing order-payment helper. Raw payment tags are not displayed as customer notes. Historical transitions are **not** invented. Creation/current fields remain available for older orders with no timeline.

Reports aggregate **all matching orders in PostgreSQL**, not a capped client sample:

- Order counts and status/payment/fulfillment distributions.
- Eligible paid-order revenue and AOV: `payment_status=paid AND status<>cancelled`.
- Cancellation/refunded-order rates with all matching orders as denominator.
- Equal-length previous-period order/revenue comparison (same other filters).
- Best-selling products by item quantity and separate highest item-revenue ranking. Product line sales are gross item sales, not allocated net order revenue.
- Latest 60 active UTC days as a compact volume/revenue chart. Dates with no orders have no bar; period totals still include the whole filter window.
- Customer spending, repeat/one-time counts, last purchase, average paid-purchase interval, inactivity, repeated cancellations/refunds, and optional co-purchase pairs.

Customer identity prefers authenticated user ID, otherwise normalized guest email. Guest orders without an email remain separate identities. Do not promise automatic merging of guest and later registered purchases. Customer metrics are **period-scoped** unless the filters cover all history. Inactive/repeat/high-risk switches filter the customer list and full-cohort customer/order/purchase/spending metrics; base order totals and underlying rows keep the original date/order filters. Both scopes are explicitly distinguished in the dashboard, and cohort totals are not sums of the top 20 examples. Inactivity means the last eligible paid purchase is older than the configured threshold; no-purchase accounts are not counted as lapsed buyers. High-risk customer review means >=3 cancellations or >=2 refunds in the selected history; it is not a fraud determination. Customer rankings return a hashed key and representative order ID rather than exposing an email list. Exact detail drill-down alone retrieves addresses and payment transaction identifiers.

## Problems and urgency

Deterministic flags explain a reason and next action. High-severity flags appear first, oldest orders first within each severity to prioritize waiting time:

- Paid but not shipped, where the order is not already completed/cancelled.
- Processing without a recent update (default 72 hours).
- Explicit fulfillment deadline exceeded, or order age beyond 48 hours while awaiting fulfillment.
- Explicit delayed shipping, or shipped past its recorded delivery estimate.
- Refund request outstanding for more than 48 hours.

Medium severity covers unpaid beyond the review threshold (default 24h, including a COD caution), missing fulfillment/tracking, high value (default USD 1,000 equivalent), quantity above 20, and a customer with at least three historical cancellations. Thresholds and dates appear in the dashboard filters. “Unusual” means exceeding configured review thresholds, not a trained anomaly model.

Detection is **on demand**, not a scheduled monitor or carrier poller. A later order update can change the results; rows are snapshots, not guarantees about current state. Shipment delay is based on explicitly entered status/expected delivery time, never a guessed carrier SLA.

## Safe operations and audit

Every new order action requires explicit admin approval, regardless of global auto-apply. Both browser and cloud agent paths use `planRequiresApproval`; legacy order-status tool calls are routed into the same guarded preview flow. Old client-only order mutations cannot execute: regenerate the preview.

1. Prepare 1–50 explicit order targets, not an unbounded filter mutation. Ineligible targets are reported separately.
2. PostgreSQL stores the exact action/payload, actor, order version, and 30-minute expiry. The UI receives an opaque preview ID. The approval card shows the full proposed text/tracking/deadline changes.
3. Select individual or multiple items in the existing approval card.
4. On apply, the database locks the preview and order, verifies actor/admin/expiry/single use/current version and eligibility, and uses **only the stored payload**, never a client-supplied arbitrary patch.
5. Each order executes in a database transaction/subtransaction; either all of that operation succeeds or all changes (including stock effects) roll back. Independent selected orders may succeed/fail separately. Audit events capture successful and failed operations, preserving the order number even if the order is later deleted. Invalid/replayed preview IDs are rejected rather than executing again.
6. Internal notes are in an admin-only append-only log, not customer checkout notes. Customer notifications insert the existing order-chat message and use its existing in-app notification pipeline.

Operations:

- **Status/cancellation**: valid four-value status, no reopening cancelled orders, no reversing completed orders, no changes to refunded orders, no cancellation after shipment, and no direct cancellation of paid orders. Completing requires paid and delivered. Existing stock-snapshot triggers handle unpaid cancellation/restock atomically.
- **Refund request**: paid order with no existing request plus a reason; sets request metadata and audit only. It **never transfers money, edits payment status or claims a refund was issued**. A subsequent recorded `payment_status=refunded` marks the request completed.
- **Fulfillment**: validated unfulfilled/packed/shipped/delivered progression, with no reversal after shipment/delivery. Non-COD dispatch requires recorded payment; COD can ship unpaid. Tracking is required to record shipment; delivery requires a recorded shipment. Completed non-unknown fulfillment cannot be reversed.
- **Shipping/tracking**: carrier/number/HTTPS URL and explicit deadlines; shipping states must agree with recorded fulfillment, and delivery cannot be undone. No carrier API side effects.
- **Private note**: 1–2,000 characters, admin-only.
- **Customer notification**: 1–200 characters, order chat/in-app only. Guest orders without an authenticated owner require manual external notification; this feature does not promise email/SMS delivery.

Two different approvals for the same order version intentionally conflict after one is applied; investigate and generate a fresh preview for the next operation. Expired/stale/failed approvals are single-use and require regeneration. Preview cleanup removes this actor's previews expired more than 30 days ago during later preparation; audit records are not pruned.

## Scaling and token budget

- Admin-only authenticated, no-store dashboard API at `/api/nemesis/ai/orders`. No new public storefront requests, caches, polling, or model call is used for page/detail browsing.
- Keyset pagination on `(created_at,id)`, with severity included for problem pages, max 50 rows per page. No large offsets or application-side full order scan.
- Indexed creation/status/payment/fulfillment/customer lookups and item joins; server-side aggregates. Search/detail avoids materializing every full order. Reports calculate counts across the full matching scope; only display/sample rows are bounded.
- Heavy report/customer/problem aggregates take a non-blocking transaction advisory lock, allowing one such aggregate at a time while normal search/detail and storefront reads remain independent. Concurrent aggregate requests get an explicit retry message rather than fan out across the database.
- Database read/apply statement budget: 8 seconds. Timeouts return an error asking for narrower filters; no partial totals are silently presented as complete. Aggregate scans still consume database resources; extremely large lifetime/co-purchase reports may need an indexed snapshot/background aggregation later. Co-purchases are opt-in to avoid expensive basket joins on ordinary customer summaries.
- Compact mode uses shared `responsePolicy`: typically five initial UI rows and three model examples; detailed mode allows a larger initial view/sample. Complete widgets stay separate from model context. Exact detail line-item examples are also bounded for the model, while all lines go to the requested detail UI.
- A compact English standalone Order Intelligence report can finish with the server-computed summary instead of another model request. Mixed tasks and other languages retain the normal loop.
- Local reveal/paging/detail inspection spends no model tokens. CSV export clearly says **loaded page only**, includes report filters/timestamp and any full-scope summary metrics, and escapes spreadsheet formula cells. It is not a full-database bulk export.

## Data gaps and integrations

The current checkout schema does not separately snapshot discounts/taxes; the dashboard says **not separately recorded**, not zero. Historical paid/shipped/delivered timestamps and fulfillment statuses are unknown when never captured. New payment transitions are stamped and operational events are recorded after installation; these are observation timestamps, not retroactively reconstructed historical times.

Payment gateway attempt/failure ledgers and partial refund amounts do not exist. Recorded payment distributions are supported, but actual gateway success/failure rates cannot truthfully be computed from `unpaid/paid/refunded`; unpaid/COD is not failure. Gateway refund execution, carrier polling, email/SMS delivery, refund rejection/resolution workflow, full-export jobs and scheduled alerts are not introduced. Financial execution and these external integrations require separate provider-specific work; this feature does not impersonate them with a database status patch.

## Migration and verification

Apply `supabase/migrations/20261051000000_order_intelligence.sql` before using these tools. It adds operational fields, private audit/previews, guarded RPCs, triggers and indexes. No existing order status/payment value is rewritten; existing fulfillment remains `unknown`, while new orders default to unfulfilled/pending shipping. The initial implementation could not apply the migration because Supabase management requests returned HTTP 502. The administrator subsequently confirmed that they ran the migration; this confirmation is user-reported, not a fresh database verification.

Private tables have RLS and no customer write access. Only the three guarded entry RPCs are executable by authenticated clients; helper functions are private.

Static verification: ESLint, TypeScript, SQL/PLpgSQL parser and diff checks. No test suites, live model requests or live order actions were run, following the user's no-test instruction. Runtime/load/provider behavior is not represented as tested.

## Plain-language order checks

The order list and detail cards present flags as “Things to check,” with an issue-specific icon, a short title, a brief explanation and a “Next step.” High priority uses an amber “Review soon” badge; medium priority uses a blue “Review” badge. Accessible badge labels retain the actual high/medium priority, so color is not the only indicator. The layout wraps on narrow screens and adapts to light/dark themes.

Examples: “Shipping update overdue,” “Payment needs checking” (or “Cash-on-delivery payment to check”), and “Shipping status missing.” A shipped order without a tracking number instead says “Tracking number missing.” Missing historical records are not presented as proof that an order was never shipped, and unpaid/COD is not described as payment failure.

`src/lib/ai/orders/alert-copy.ts` translates the existing database reasons for display and CSV titles; `order-alerts.tsx` renders them consistently. All ten existing flag reasons are covered. Unknown/new reasons keep their original reason and recommended action instead of being hidden. No database migration, rule change, priority change, extra AI request, or order mutation is needed for this presentation update.
