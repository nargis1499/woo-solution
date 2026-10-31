# Nemesis AI response-budget policy

All future AI capabilities should use `src/lib/ai/response-budget.ts` instead of hard-coding response length by model name or assuming that paid means unlimited.

## Compact versus detailed

`responsePolicy(settings, observedRate)` returns the mode, model sample size, initial visible row count, and summary instruction.

Use **compact** when any of the following applies:

- The admin selected Economy mode (an explicit token-saving preference).
- The provider reports a token quota of 16,000/minute or less.
- The provider reports a request quota of 30 or less in its reported window.
- Fewer than 2,000 tokens remain, or less than 25% of the token quota remains.
- Two or fewer requests remain, or less than 20% of the request quota remains.

Otherwise Standard/High modes allow **detailed** reports and fuller explanations when useful/requested. Unknown quotas stay unknown; neither provider/model names nor missing headers prove that an account has a particular free/paid quota. Request quota headers can refer to daily or other windows, not necessarily minutes.

Cloud agent turns adapt after the provider's response headers arrive, before tool results are serialized. OpenAI-compatible and Anthropic adapters capture token and request headers. Providers that omit quota headers can still use Economy mode. Browser-direct Ollama uses the configured preference because local inference normally has no hosted quota headers.

This is payload/request optimization, not a universal quota scheduler. It cannot guarantee that another application hasn't consumed the same account's quota or discover unreported account limits before the first request. Existing overload/fallback handling remains in place.

## Rules for future capabilities

1. Compute business data deterministically from live store tools. Do not replace calculations with model guesses to save tokens.
2. Separate **UI data** from **model context**. React can receive complete structured cards without sending that entire widget back through the LLM.
3. Compact model results contain counts and at most three actionable samples; detailed mode allows twelve samples. Preserve critical incomplete-data signals and indicate sampling, never imply omitted rows do not exist.
4. Do not ask the model to reproduce already-rendered tables/cards. Compact dashboard summaries should be at most two short sentences (around 60 words). Fuller explanation is allowed when unconstrained and useful/requested.
5. Local reveal/expand controls should expose already-loaded data without another model request. Do not relabel a limited result batch as the entire store.
6. When a standalone read-only report already has a deterministic summary, a constrained turn can finish without an additional model completion. Never fast-finish mixed tasks, approval/write workflows, unsupported tasks, or responses that still need reasoning. English deterministic summaries are used only with English language settings; other languages retain the model step.
7. Never truncate generated replacement content, mutation arguments, approval selections, validation rules, or calculation inputs. This policy controls presentation and read-result samples, not write correctness.
8. Narrow tool schemas only for an unambiguous constrained task. Keep the full catalog for mixed/ambiguous requests. The inventory read-only fast path advertises only the analysis tool; it does not omit write tools when a write is requested.

## Inventory Intelligence behavior

- Compact mode initially displays up to five flagged rows. Other loaded rows are available through “Show all loaded product details”; revealing them uses no tokens or model requests.
- Detailed mode initially displays the full loaded batch. Both modes use short, plain-language calculation details instead of formula dumps.
- The “Assumptions & data quality” panel is removed. The lookback/lead time remain in the header, limited evidence stays labeled, and incomplete-history/disabled-stock warnings remain visible.
- Forecasts/reorders remain unavailable where history or sales attribution is insufficient. UI simplification must not turn unknown forecasts into reassuring zeroes.
- Full warning/calculation data remain in the structured report for correctness and future tooling; they are not serialized wholesale into model context.
- Token telemetry distinguishes provider-reported TPM from session totals. It never assumes an 8,000-token account quota when headers are missing; usage includes input/history/schemas as well as output.

## Order Management Intelligence

Order tools also use this policy. Full order widgets never become model context: counts/metrics and bounded examples are serialized separately, including bounded line-item examples on exact investigations. Compact order reports initially show five rows, with local reveal/paging/detail inspection and loaded-page CSV export requiring no model call. The unambiguous “Analyze order intelligence” starter advertises only the read tool in compact mode; unfamiliar or mixed tasks keep the full catalog. An eligible compact English standalone order report can also finish with its deterministic summary without a redundant completion. Approval messages/operation payloads remain complete and are stored server-side, never shortened to satisfy a summary budget. See [Order Intelligence](nemesis-order-intelligence.md).

## Verification for this change

Lint, TypeScript, and diff checks are static verification. No test suites or live provider requests were run, following the user's earlier no-test instruction. No exact token-reduction claim is made without a live measurement; savings come from smaller schemas/results and eliminating the redundant model round on eligible reports.
