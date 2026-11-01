# Read-report execution and token policy

## Financial boundary first

`report-money.ts` formats financial fields **only in model-facing Customer/Order report projections**. `40000000` micros becomes the labelled string `$40.00 USD`, not 40 million dollars. Money fields receive `USD` names; counts are not converted. Unavailable amounts remain null; unsupported/non-exact integer source amounts fail rather than silently round an unsafe JavaScript integer. Conventional currency formatting rounds display to cents; exact micro-dollar calculations remain in the database and widget/report state. Never apply this serializer to mutation arguments, approved actions, widgets or financial calculations. Existing core store analytics/inventory price tools already format their model-facing prices.

## Do not pay for a redundant summary

The shared `read-report-policy.ts` is used for cloud/server and browser-direct Ollama:

1. A conservative **whole-message** read classifier identifies supported self-contained reports. It understands natural variations such as “give me the valuable customer”, “show my top 5 customers” and simple new/repeat/inactive/analytics requests, plus the existing Order/Inventory report starters. It is not an extra LLM call, substring-only keyword router, or an attempt to infer every possible request.
2. A fresh, scoped request with no relevant history or custom instructions exposes only its relevant tool, irrespective of economy/detailed budget mode. The initial model still chooses filters and calls the live read tool; no database data is guessed from the prompt.
3. Only one **successful matching** read, a matching structured widget/mode, an actual server-built factual summary and no action plans can finish deterministically. English/default-English requests receive the summary and card without a second model request. Provider errors/retries or a model that does not make the expected call do not promise one total HTTP attempt.
4. Other configured languages retain model completion for translation; once this simple read is complete, native tool schemas (and Ollama fallback's embedded tool catalog) are omitted from that finalization call.
5. Unknown wording, named/ambiguous identities, unsupported modifiers, mixed tasks, comparisons, recommendations, explanations, conversational dependencies and custom instructions retain normal grouped tools and the multi-step agent. No writes, approvals, proposed content, or user instructions are shortened/auto-applied by this policy. It is an optimization, not authorization.

The classifier deliberately rejects uncertain wording rather than trying to optimize all natural language. Customer profile/history/search requests retain identity-resolution tools. “Returning” is not treated as the same as repeat purchases within a selected window. More report families should extend this shared policy and supply successful-read summaries, not add another provider-specific tool loop or classify every request through another paid AI call.

## Keep the necessary model context small

- Customer tool/parameter descriptions state shared rules once instead of repeating null/default/privacy definitions in every field. Nullable types and backend validation remain unchanged.
- The customer model projection carries full-cohort metrics, relevant scope and budget-limited samples. Unused filters, representative-order IDs, duplicate window/lifetime values, signup/refund/cancellation details unrelated to the selected mode, and repeated response-policy instructions are omitted. Details retain their supported financial/history fields when relevant. Contacts never enter this projection.
- The complete widget is still sent directly to the administrator; it is not serialized wholesale back to the model. Pagination, customer contact/detail inspection and history browsing remain model-free.
- A simple customer spending ranking uses a server-formatted currency summary and labels its selected order-date window. It does not describe recorded spending as profit/predicted lifetime value, or new buyers as verified conversion times.
- If additional reasoning/reads are needed, the agent keeps relevant tools; we do not globally clear tool catalogs after every tool result. Cross-tool comparisons use full-cohort totals, not sums of sampled customers.

Existing AI usage collectors still record actual provider-reported input/output tokens and request totals for the whole turn. Tool count reflects the initial selected catalog. No exact percentage/number of tokens saved is asserted without provider measurements. A deterministic summary creates no artificial usage event; the actual first model call remains logged.

## Verification constraints

For this change: ESLint, TypeScript no-emit and diff checks only. No test suites, synthetic report executions, live AI requests, browser end-to-end runs or database mutations/migrations. Live provider token savings are therefore not measured here. All optional null-filter behavior, admin guards, identity separation and read-only customer restrictions remain intact.

## Universal tool pipeline

[The shared policy for all tool calling](ai-tool-token-policy.md) now extends schema loading, compact model-only results, instruction deduplication and content-field projection to every capability. Unknown requests no longer send every registered tool schema upfront; the model can load the groups it needs. This does not expand deterministic completion to arbitrary writes or drop multi-step requirements.
