# Customer Intelligence inside Nemesis AI

Eight read-only tools form the `customers` capability group:

| Tool | Responsibility |
|---|---|
| `get_customer_details` | Available profile, recorded contact details, order/purchase totals for an exact customer |
| `get_customer_purchase_history` | Exact customer's paged order history, including non-qualifying statuses |
| `search_customers` | Literal recorded-name/email search; separate matches, stable opaque keys |
| `get_top_customers` | Highest recorded qualifying spending in the selected order-date window |
| `get_inactive_customers` | Past qualifying buyers whose lifetime last qualifying order date is older than the threshold |
| `get_repeat_customers` | At least two completed **and paid** purchases in the selected window; configurable higher minimum |
| `get_new_customers` | First lifetime qualifying order placed within the selected window, not recent signups |
| `get_customer_analytics` | Exact full-matching-cohort buyer, repeat/new/returning/inactive counts, spending and AOV |

Use the new **Customer intelligence** chat suggestion or natural-language requests. No new standalone dashboard, marketing delivery integration, customer edits, automatic discounts, messages or account actions are added. Customer results render as structured chat cards with model-free search, page-size controls, next/previous pages, full purchase-history inspection, contact detail inspection and order links. Initial visible rows follow the shared response budget; revealing the rest of a loaded page does not call the model. Existing chat scrolling/loading/approval and AI configuration behavior is preserved.

## Definitions and identity

- **Qualifying purchase:** `status=completed AND payment_status=paid`. Refunded, cancelled, unpaid and merely processing paid orders do not qualify. This is intentionally stricter than existing Order Intelligence's broader paid/non-cancelled revenue rules. Values are base USD integer micros (1 USD = 1,000,000), never profit or predicted lifetime value.
- Purchase metrics are over **order-placement dates**, using the **currently recorded** statuses. Completion/conversion timestamps and historical status transitions cannot be reconstructed reliably for all legacy orders. `get_new_customers` is an explainable first-qualifying-order-date cohort, not proof of when a payment or conversion occurred.
- `from` is inclusive, `to` exclusive, UTC. Default window: last 30 days for analytics/new, all history for other tools. New/repeat/top are not signup cohorts. Default inactivity is 90 days; never-purchased accounts are not inactive buyers. New buyer first-purchase and inactive last-purchase checks use lifetime history before `to`, even if `from` is recent. Repeat minimum is at least two and cannot be weakened to one through arguments.
- Customer rows explicitly separate lifetime totals (before cutoff) and window purchases/spending. Top ranks by window spending. Repeat uses window count. Inactive uses last lifetime qualifying order date. Search is literal substring, not wildcard/regex expansion; registered profile name/email is preferred, otherwise a representative recorded order name/email is used. It is not a search over every historic name/address alias.
- Registered identity: `u:<user UUID>`. Guest email group: `e:<MD5(normalized exact email)>`; this is only a grouping heuristic, not verified ownership or anonymity. Guest and registered identities remain separate even with the same email. Missing-email orders: `o:<order UUID>`, isolated per order, never merged by name. If a user was deleted and its historical `user_id` was cleared, the original registered identity is no longer reconstructable; email grouping must not be described as a recovered account.
- Non-admin registered profiles without purchases appear in search/analytics as unconverted accounts. Admin profiles without orders are omitted; administrators who actually ordered remain in order-derived buyer identities.
- Buyer/returning/repeat metrics cover all matching customers, not the visible page or model sample. AOV = qualifying window spending ÷ qualifying window purchases (rounded to a micro); no purchases yields unknown/null AOV, not invented zero. Repeat-buyer rate, if explained, uses window buyers as denominator, not all signup accounts. Cancellation/refund counts are recorded counts, not fraud judgments, refund-value accounting or loss calculations.

## Privacy and integration

Every service/action checks admin access; the stable security-definer RPC also checks a non-null authenticated identity and `is_admin()`. Anonymous execution is revoked, search/key/date/threshold/pagination values are validated, and the search path fixes pg_catalog/public/pg_temp. There are no business-table writes. Model output contains full-cohort counts, currency-formatted totals and budget-limited row samples, not private contacts. Detail email/phone/address is returned only in the structured admin widget/action response, never included in tool-result JSON sent back to the model. The recorded address comes from a representative order and is clearly labelled as not a verified current address. “Complete details” means available supported customer information, never Auth passwords, sessions, API keys or payment secrets.

User prompts/tool arguments may themselves contain a customer identifier or supplied email; minimize these and do not treat AI-log redaction as a guarantee that no personal information ever reaches the configured provider. Details opened directly through the model-free action do not create an AI completion/log. Customer names and pseudonymous IDs can still be personal information; use administrator access responsibly.

Cloud and browser-direct Ollama share the same selected tools, server executor and report contract. Supported self-contained customer reports narrow to the relevant tool; a successful English read can finish from a code-generated summary without another model call **only when there is no relevant history or custom instruction**. Other languages retain model completion for translation without redundant tool schemas; mixed/custom requests and configured custom instructions keep the normal agent. Financial model payloads use formatted USD strings, not raw micros. See [the shared report execution policy](ai-report-execution.md). Uncertain conversational dependencies still retain broad tools/history; this is not an authorization router.

## Query, pagination and installation

Apply `supabase/migrations/20261057000000_customer_intelligence.sql` once. It adds indexed customer-history/guest-key access and one stable read RPC, not a persistent customer mirror or configurable settings row. The live fresh-client SQL export picks up this function/index schema automatically; no new client-setup settings registration is needed.

Each report aggregates the full eligible source scope once via materialized CTEs. Exact-identity requests constrain source orders/profiles before aggregation. Customer and history lists paginate on the server (1–50 per page, page cap 10,000) with deterministic ties, while totals cover the full match. Pagination reads live data rather than a persisted snapshot; later data changes can shift rows/counts. The RPC configures a 15-second statement timeout and the client a 20-second fetch budget; large stores may exceed the applicable database/fetch budget; errors are explicit and no partial totals are substituted. This version does not promise constant-time all-history cohort calculations or precomputed customer lifetime value.

Amounts outside JavaScript's exact integer range cause a database error rather than silently rounded financial results. UI dollar formatting remains conventional currency precision; calculations retain micros. Contact details and history are fetched on demand. Full-cohort calculations are not made by the model, and browsing adds no AI token usage.

Verification: lint, TypeScript, static SQL/PLpgSQL parsing and diff checks. No test suites, live AI requests, synthetic customers/orders, automated campaign operations or end-to-end report/browser runs are performed for this implementation. Database migration installation and read-only permission/catalog checks are deployment verification, not a claim of live AI/runtime correctness.

Deployment note (2026-11-01): the migration was applied to the connected store. Read-only catalog verification confirmed a stable security-definer function, fixed search path, configured 15s timeout, valid indexes, anonymous execution denied, and authenticated execution granted (with the in-function admin guard). Local and installed function bodies matched MD5 `47c872962e42eb826124372ba0dbf987`. The customer report RPC itself was not invoked as a test.

### Optional tool arguments

All optional customer tool parameters accept either their declared value or JSON `null`. Omission and `null` both retain the existing server defaults; non-null values still undergo validation. Nullable sort enums explicitly include `null` as an allowed enum value. Customer details/history still require an exact non-null customer key or registered UUID; making each alternative nullable does not permit an identity-free detail read. Gemini sends function declarations through `parametersJsonSchema` so the same standard JSON Schema nullable unions work without passing array-valued types to its native Schema format. OpenAI-compatible, Anthropic and Ollama paths retain their existing JSON Schema transport.

Financial-formatting update: customer/order model-facing money is now converted to labelled USD strings before generation; `40000000` micros is `$40.00 USD`. Original report/widget/database amounts remain exact micros. Repeated optional-null instructions were removed from descriptions to reduce input size, but nullable type/enum schemas and null-as-default validation are unchanged.
