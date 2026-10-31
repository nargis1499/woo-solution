# Dashboard diagnostic logs

## Scope and operation

`/nemesis/logs` (sidebar **Logs**, **AI Log** tab) records new AI completion HTTP attempts, not historical requests or every application event. Settings connection pings that use completions are included; model-list discovery is not. Schema/category boundaries can be extended for other diagnostics later. Operational order audits and approval records are separate and are never deleted here.

Open **Details** to inspect the **final serialized outgoing provider body**: system instructions, user/history/tool messages, tool schemas and generation options. OpenAI-compatible, Anthropic and Gemini adapter payloads are captured at the fetch boundary, after conversion to each provider's wire format. Retries (including reasoning-parameter compatibility retries) and model fallback attempts get separate rows. Cloud chat rounds and SEO worker calls share a request-group UUID. Browser Ollama recovery attempts share their browser turn's UUID; server-side tool subcalls may have separate groups.

Each row includes server creation time, requested model/provider, source, HTTP outcome, duration and reported input/output counters where available. The provider-resolved model can be inspected in its response body. HTTP success does not guarantee that later JSON parsing, tool validation or store execution succeeded. Network errors have unknown usage. A pending row can indicate interruption or a failed completion-log update. This is best-effort diagnostics, not a tamper-proof or complete audit trail.

## Security, privacy and limits

- Pages, Server Actions and browser ingestion require an administrator. RLS independently gates reads/deletes and binds inserts/updates to the authenticated administrator. No service-role key or public log access is used. New grants do not modify existing operational permissions.
- Fetch headers and endpoint URLs are excluded from capture metadata; credential-like fields are filtered from bodies. Known current provider keys, common secret formats, named secret/contact/payment fields and recognizable email addresses are redacted from captured bodies. JSON-encoded tool arguments/results are inspected too. Redaction is best-effort: arbitrary personal details/secrets in free text cannot be reliably classified. Store content is sensitive even after filtering; access is restricted to admins.
- Details show `{data, redacted, truncated}` envelopes. This is not a byte-identical reproduction when privacy filtering/limits apply. It cannot expose provider-internal prompts or determine the exact tokenization of individual prompt components.
- Payload capture is bounded (100,000-character content budget, nesting/array limits, 240 KB final data-byte safeguard; database envelope limit 300 KB). Oversized responses are not fully captured (250 KB clone-read ceiling), with an explicit diagnostic note. Original AI payloads/responses are never truncated by logging.
- Lists fetch metadata only; large bodies are fetched on demand in an accessible detail dialog. Pagination uses stable `(created_at, id)` newest-first ordering and server-validated 10/25/50/100 page sizes. Counts/pages are live snapshots and may shift while new logs arrive or retention runs.
- A start write precedes the provider request; a finish write follows. Database writes have two-second abort limits. Logging errors use fixed, non-sensitive warnings and do not fail the AI request. Extra database writes/readbacks introduce bounded overhead and consume database resources, not AI tokens. No fire-and-forget writes that disappear when serverless requests end.
- Browser-direct Ollama sends sanitized diagnostics back to an admin-only same-origin endpoint (350 KB input ceiling; server re-sanitizes). Browser write requests have three-second deadlines. Browser data is client-reported and not authoritative; tab closure/network interruption can lose records. Model requests never depend on diagnostic success.
- Single/all deletion is explicit and confirmed. An in-flight call deleted before finishing is not reinserted. Requests begun after a delete-all operation may create new logs. Deletion affects live database records only—not provider records or database backups.

## Installation and scheduled retention

Apply `supabase/migrations/20261052000000_ai_diagnostic_logs.sql` once. It creates the tables, admin policies, restricted cleanup function, enables `pg_cron`, and registers **nemesis-ai-log-retention** with schedule **`*/5 * * * *`**. The migration is transactional through the migration runner; if extension installation/scheduling fails, fix the database prerequisites rather than substituting browser-driven deletion.

Selectable retention: **1 hour, 3 hours, 6 hours, 1 day, 3 days**. Default: **3 days**. Server timestamps are authoritative. Changes apply to existing logs on the next scheduled run. The postgres-owned security-definer function has a fixed search path and no PUBLIC/anon/authenticated execution privilege. It reads the configured retention, uses an indexed cutoff and an advisory transaction lock, and removes up to ten batches of 500 rows per run with `SKIP LOCKED`. A normal expired record is removed within approximately five minutes of eligibility; outages or large backlogs can delay physical deletion. The job runs with the dashboard closed and independently of Vercel/Cloudflare.

The settings card displays the last successful cleanup time and rows removed during that run. No first timestamp means cleanup has not yet completed; an old timestamp signals a scheduler/database issue. A successful heartbeat does not claim that a backlog was fully drained. Inspect `cron.job` / `cron.job_run_details` as a database administrator to diagnose failures; do not grant dashboard admins access to general cron management. pg_cron's own execution-history retention is separate from AI log retention.

## Verification scope

Lint, TypeScript and diff checks only; no test suites or live AI requests. Database migration application and read-only verification of the registered scheduler/schema are deployment operations, not a claim of end-to-end browser/provider verification. No percentage token savings or zero storage-cost claim is made. This feature adds observability, not changes to AI prompts, approvals or model routing.

## Deployment record

The migration was applied to the connected project on 2026-10-31. Read-only verification confirmed the `nemesis-ai-log-retention` job is active, owned by `postgres`, and scheduled every five minutes; default retention is 72 hours. Log-table RLS is enabled, anonymous reads are denied and authenticated users cannot execute the cleanup function. Do not reapply this migration to that project. Scheduled execution is verified separately from job registration; no synthetic log entries or AI requests were created to exercise it.

Read-only follow-up confirmed a natural scheduled execution **succeeded** at `2026-10-31 11:25:00 UTC`, updated the cleanup heartbeat, and removed zero rows (no diagnostic requests were generated during implementation). This confirms scheduler/function execution, not an end-to-end provider or populated-log deletion test.

## Log-details scrolling

The details dialog has a bounded viewport height, a persistent title/Close header and one keyboard-focusable vertical scroll region for both payloads. Payload blocks have no separate scrollbars or height caps; long unbroken strings wrap with `overflow-wrap: anywhere`, including their intrinsic sizing contribution. The dialog's grid/flex items have explicit zero minimum sizes so long tokens cannot expand the modal horizontally. Scrolling uses a slim theme-colored thumb with transparent track and hidden native arrow buttons, shared with the existing chat scrollbar styling. Payload contents, redaction, logging and retention are unchanged. This UI correction was checked with lint, TypeScript and diff checks only; no test suites or live provider calls were run.
