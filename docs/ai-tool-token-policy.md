# Shared token policy for all Nemesis tools

This policy covers Customer/Order Intelligence, Inventory Intelligence and product operations, pricing, store snapshots, content edits/translations and SEO audit/fix previews. It is shared by the cloud/server agent and browser-direct Ollama (native tools and prompt fallback). No schema migration or new AI setting is required.

## 1. Load schemas on demand instead of sending the whole toolbox

- Self-contained supported reports keep their single-tool, successful-read shortcut.
- Small known topics (up to three scoped tools) start with their schemas and a brief `load_tool_groups` escape hatch. Broader catalogs start with a name-only directory instead of all parameter schemas. A conservative scope is not a restriction on available capabilities: missing dependencies can be loaded during the same turn.
- Uncertain topics/follow-ups/non-English requests that cannot be scoped locally start with **one metadata tool**, not the complete registered schema catalog. Its small directory describes all seven capability groups. The model preferably requests exact `toolNames`, loading only those schemas; `groups` remains the fallback for whole capabilities and mixed dependencies. Names are checked against the registered tool allow-list; invalid names produce an error, not guessed execution.
- The next request receives real schemas only for the selected names (or explicitly requested whole groups). They are **not** duplicated inside the tool-result JSON; that response contains names and status only. Loaded schemas persist in that turn, with a brief loader description instead of repeating the full directory. Group-specific system notes are sent only for active groups. Existing categories are loaded/refreshed when a newly requested inventory/pricing dependency needs them; metadata loading must not turn a category-filtered operation into a catalog-wide guess.
- Schema discovery may add a model round to uncertain requests. Up to three discovery-only rounds do not consume the normal business-action round allowance; further rounds use the existing bounded action budget. This preserves the read → preview → response workflow under economy mode without allowing infinite schema loops. Loading metadata alone is not a store read, change or proof of task completion. Omitted, null or empty optional group/name lists mean absent; at least one valid selection is required.
- Discovery is **not authorization**. Every executor, actual data read, preview and approved write keeps its existing admin/validation/approval checks. Nothing is auto-approved by loading a group. Unknown/unsupported store operations still must not be invented.

Tradeoff: uncertain requests can use an additional small planning request, but avoid repeatedly transmitting every tool's parameter schema and unrelated domain rules. Very small requests or requests genuinely needing all groups may not save tokens; no universal percentage is promised. Small directly scoped tasks do not need an extra discovery request unless a missing capability is actually used. Broad catalogs deliberately use discovery to load exact schemas.

## 2. One model-output policy at the shared executor boundary

`tool-results.ts` is applied by the public `executeAgentToolCall` wrapper for every tool, across both paths. Explicit projections avoid generic lossy truncation:

| Capability | Model input reduction | What stays intact |
|---|---|---|
| Inventory/product search | Budgeted example rows, explicit sample/loaded/matched counts | Full fetched/UI data and actual matching count |
| Store snapshot | Budgeted product/order examples | Snapshot aggregates and source-coverage caveat |
| Discount previews | Small price-change examples; omit unrelated low-stock suggestions | Full approval card, exact discount arithmetic and targets |
| Product status/stock/featured previews | Small example list, labelled as sampled | Full target list and mutation arguments |
| SEO audit/fixes | Counts plus target/field examples, not all proposed replacement text | Full generated copy in approval plans and apply-time validation |
| Customer/Order Intelligence | Existing count/sample projections and formatted financial values | Database totals, scope, unknowns and full report widgets |
| Content reads | Explicit editable-field projection and identity-only ambiguous candidates | Complete selected source values and real IDs/version timestamps |
| Content/order-operation previews | Already-small status/result acknowledgements | Full approved replacement/message, old/new values and targets |

Shared response-budget prose is not copied into every result when already in the system prompt. Within a turn, identical **per-tool instruction strings only** are sent once; earlier instruction messages remain in context. Error results, data, statuses, evidence warnings, counts, identities and scope are not deduplicated. Unknown future result contracts pass through until an explicit projection is registered; the pipeline never blindly chops arbitrary JSON or assumes a sample is a total.

Legacy store snapshot windows use the latest 200 orders and exclude cancellations but not every unpaid order. Their payload now makes that limitation explicit. Use Order Intelligence for exact full-period paid revenue; optimization must not make a bounded snapshot appear to be a full-cohort calculation.

## 3. Content reads should not load unrelated pages/copy

`query_content.fields` accepts the supported editable fields needed for the task (such as `description`, or `content` plus `seo_description`). Omitted/null fields preserve the compatible all-fields read. Each requested value is complete, **not an excerpt**. Whitelists enforce entity-specific columns.

Name searches first retrieve identity metadata. Multiple candidates return up to five stable identities, a more-candidates flag, and a request to select/narrow; they do not transmit five full page bodies. An exact UUID/slug or one unambiguous candidate retrieves the full selected fields. Ambiguity never authorizes editing all matches. Media and product/page/post field restrictions, HTML sanitization, source-as-data instructions and optimistic apply-time safeguards remain in place.

## 4. Do not reduce tokens by damaging the request

Tool/parameter descriptions and shared system rules are manually shortened while preserving enums, required values, meaningful limits/defaults and critical distinctions (completed+paid vs paid/non-cancelled, forecast uncertainty, private notes, refund-request-only behavior, mandatory approval and no invented IDs). There is no arbitrary description truncator.

Full user input, selected relevant history message contents, tool arguments, selected IDs and authored replacement text are not character-cut by this change. Legacy server-side 600/2500-character history cuts and the 4000-character current-request cut were removed: these could discard critical instructions or copy. Existing bounded topic/history selection still applies. A genuinely long document edit can therefore remain expensive; correctness takes priority over an artificially small token count.

The optimizer does not drop a tool-call/result pair or replace mutation arguments with summaries. Provider tool-call IDs remain unique even for metadata rounds and browser round retries. Gemini thought signatures and native OpenAI/Anthropic IDs are preserved; only internally generated/fallback IDs use unique UUIDs.

## 5. Extension and verification

Register new tools in `AGENT_TOOL_GROUPS`; new groups also extend `AgentGroup` and `TOOL_GROUP_DIRECTORY` (the typed directory makes missing entries visible at compilation). Real schemas are loaded from that registry. Add explicit model-facing result projections where safe; never put full widgets/plans into tool results. Preserve supported deterministic report finish behavior in the shared report policy, not provider-specific shortcuts.

Existing diagnostic logs capture actual provider-bound bodies and usage collectors count all reported requests, including discovery. The UI's tool-count metadata describes the initial catalog, not the eventual union of lazily loaded tools. Model-free paging/details/approval remain model-free.

Verification for this implementation: ESLint, TypeScript no-emit and diff checks. No test suites, connection tests, synthetic tool executions, live model requests, database mutations or end-to-end browser runs. Actual token savings and live provider compatibility are not runtime-measured here; use real per-turn logs after deployment, not estimated claims based on JSON character count.

## Product/stock query extension

`query_inventory` now loads one reusable comparison/filter schema, not separate per-sentence tools. General catalog routing no longer removes tools using an English read-prefix regex; existing lazy discovery and narrow report allowlists remain. Database queries return exact full-cohort metrics and bounded pages; the existing model-only `items` projection keeps only policy-sized examples, with loaded/shown counts and `sampleOnly`. Full UI pages and model-free pagination remain intact. The richer schema has a real token cost when loaded; no measured savings claim is made. See [product/stock query policy](product-stock-queries.md) for the applied read-only migration, supported operators, validation and verification scope.

## Missing-schema reliability and authorized smoke tests

Directory guidance now distinguishes listed names from callable schemas. Known unloaded-tool provider rejections recover by loading the exact registered schema and regenerating within a two-retry bound; returned unloaded calls defer to schema-only loading before execution. Full catalogs, original messages, IDs, copy and approvals are preserved. Normal requests add no recovery round; failed recovery generations have unknown token cost. `npm run test:ai` provides isolated registry-wide adapter/schema/authorization checks and orchestration regressions, as newly authorized by the administrator. See [tool loading recovery and test limits](ai-tool-recovery.md).
