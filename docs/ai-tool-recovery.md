# Reliable lazy tool loading and lightweight checks

## Failure and fix

A directory can mention `get_top_customers` while the actual provider `request.tools` contains only `load_tool_groups`. Some models skip discovery and attempt that business tool directly. Groq can reject the entire generation before our executor sees any tool calls. Small wording changes then appear to determine whether the request works.

The shared directory now explicitly says that listed names are **not yet callable**: load exact schemas, wait for the result, then call the tools. This is model guidance, not the only safeguard:

1. **Provider rejection:** the completion client recognizes HTTP 400/422 errors explicitly stating a named tool was not in `request.tools`. With discovery enabled, it resolves the exact name against the registered catalog, adds only that schema, refreshes capability instructions/category context, and regenerates using the unchanged conversation. The catalog persists in subsequent rounds. At most **two** schema-recovery attempts are made per model invocation.
2. **Returned native/prompt call:** some providers/local models return an unloaded tool instead of rejecting it. The cloud loop and browser execution endpoint defer that call into metadata-only loading. The original assistant call ID/name stays in history; its result explains that schemas were loaded, not that a read/write was performed. The model must call again with the supplied schema. These schema-only rounds share the existing bounded discovery-round allowance.
3. **Batch isolation:** schema availability is snapshotted at generation/request time. A loader earlier in a batch cannot make an unloaded sibling write call execute in that same batch.
4. **Tool-free finalization:** neither recovery nor an unexpected returned tool call can reopen a language-only/last-round completion for execution.

Only exact registered tool names may be loaded. Unknown names, already-loaded schema failures, invalid argument schemas, authorization errors, network/overload/rate-limit errors, and arbitrary provider response text do not trigger this recovery. `failed_generation` is never parsed into executable arguments. The original user prompt and prior tool messages are preserved; this is not a phrase classifier or a blanket resend of every schema.

A `reasoning_effort` compatibility retry now requires an error mentioning that option, rather than generic words such as “unknown”; unrelated tool errors no longer cause that redundant retry.

The browser sends the exact loaded tool names alongside capability groups. The server validates that list against its registry; it is protocol state, **not authorization**. All admin checks, plan previews, mandatory approvals and apply-time guards remain. Loading schemas never applies a plan or reads customer/product records.

Failed schema generations can consume quota without reporting token counters. Failed HTTP attempts (including reasoning-option/fallback retries) are retained and included in the usage collector's request count; total token metrics are shown as unknown instead of claiming complete measured savings. Normal successful responses retain their reported counters. Per-model counts attribute confirmed responses only; failed attempts may not reveal the actual routed model. Existing provider diagnostic capture still records individual HTTP requests. Recovery can cost an extra generation when needed; it adds no network request on the normal path.

## Run the lightweight suite

```sh
npm install --legacy-peer-deps
npm run test:ai
```

Current local result: **396 checks passed in about two seconds** (including orchestration and provider matrices).

The suite runs in Node with Vitest and uses AJV to validate representative tool arguments against the actual registered schemas. It discovers tools from `AGENT_TOOLS`, not a duplicated tool-name list; adding a new tool without a fixture fails the coverage check. `load_tool_groups` is also covered.

For **every registered tool**:

- schema serialization, representative arguments and declared required parameters;
- non-admin execution denied before datastore access;
- discovery and exact-schema loading with no business operation, preview or database call;
- native/prompt unloaded-call deferral, original IDs/arguments, and loaded-call dispatch;
- request schema/returned arguments through all eight real provider adapters, using mocked HTTP;
- for business tools, missing-schema HTTP rejection → exact-schema retry through each adapter.

Additional regression cases cover both customer phrasings from the screenshot, the stock >20 wording, unknown/unregistered tool names, unrelated errors, retry bounds, finalization/loaded-schema guards, native IDs/Gemini thought signatures, and request/unknown-token accounting. Route-level checks exercise the real cloud orchestration for both customer phrasings with mocked provider replies/execution, plus browser deferred/retry handling, invalid catalog state and loader + write-preview batch isolation. CI runs this same small suite before the build; local completion/merge does not wait for CI.

## Limits of these checks

These are **isolated contract/protocol/routing smoke tests**, not exhaustive business-operation or natural-language tests. Outbound requests and Supabase access fail closed unless explicitly mocked. No live paid model calls, production database reads/writes, plan applications, notifications or real store changes occur. Every adapter uses synthetic responses; this does not prove a real model understands every phrasing or that every business/database edge case is correct. Backend financial calculations, SQL filtering, provider availability and complete browser interactions require separately authorized integration/end-to-end coverage.
