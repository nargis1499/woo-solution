"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FileClockIcon,
  RefreshCwIcon,
  Trash2Icon,
  ScanTextIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import {
  deleteAiLogs,
  getAiLogDetail,
  saveLogRetention,
} from "@/app/nemesis/logs/actions";
export type AiLogRow = {
  id: string;
  created_at: string;
  trace_id: string;
  source: string;
  provider: string;
  model: string;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};
type Detail = Awaited<ReturnType<typeof getAiLogDetail>>;
const periods = [
  [1, "1 hour"],
  [3, "3 hours"],
  [6, "6 hours"],
  [24, "1 day"],
  [72, "3 days"],
] as const;
const date = (v: string) => new Date(v).toLocaleString();
const counts = (v: number | null) =>
  v == null ? "Not reported" : v.toLocaleString();
export function AiLogsBoard({
  rows,
  total,
  page,
  per,
  retention,
  cleanupAt,
  cleanupDeleted,
  unavailable,
}: {
  rows: AiLogRow[];
  total: number;
  page: number;
  per: number;
  retention: number;
  cleanupAt: string | null;
  cleanupDeleted: number;
  unavailable: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const pages = Math.max(1, Math.ceil(total / per));
  const run = (action: () => Promise<void>) => {
    setError("");
    start(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Log operation failed.");
      }
    });
  };
  const remove = (id: string | null) => {
    if (
      !window.confirm(
        id
          ? "Permanently delete this AI diagnostic log?"
          : "Permanently delete ALL AI diagnostic logs? This cannot be undone. Order/product audit records will not be deleted.",
      )
    )
      return;
    run(async () => {
      await deleteAiLogs(id, "DELETE");
      if (!id || detail?.id === id) setDetail(null);
      router.refresh();
    });
  };
  return (
    <div className="space-y-5">
      <nav aria-label="Log categories" className="flex gap-2 border-b pb-2">
        <Link
          href="/nemesis/logs"
          aria-current="page"
          className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
        >
          <FileClockIcon className="size-4" />
          AI Log
        </Link>
      </nav>
      {unavailable ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          Logs are unavailable. Apply the AI diagnostic logs migration and check
          database access. AI requests can still run without diagnostic logging.
        </p>
      ) : null}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Automatic deletion</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              pg_cron checks every 5 minutes, even when this dashboard is
              closed.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            Keep AI logs for
            <select
              aria-label="AI log retention"
              className="rounded-md border bg-background px-3 py-2"
              value={retention}
              disabled={busy || unavailable}
              onChange={(e) =>
                run(async () => {
                  await saveLogRetention(Number(e.target.value));
                  router.refresh();
                })
              }
            >
              {periods.map(([hours, label]) => (
                <option key={hours} value={hours}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {cleanupAt
            ? `Last successful cleanup: ${date(cleanupAt)} · ${cleanupDeleted.toLocaleString()} deleted`
            : "First cleanup has not been recorded yet. Check again after the scheduled job runs."}{" "}
          If the timestamp stops updating, check the pg_cron job. Retention
          changes apply to existing logs on the next cleanup. Large backlogs may
          need multiple batches.
        </p>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} AI call attempts · Newest first
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            isDisabled={busy}
            onPress={() => router.refresh()}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
          <Button
            variant="outline"
            isDisabled={busy || unavailable || total === 0}
            onPress={() => remove(null)}
          >
            <Trash2Icon />
            Delete all AI logs
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each attempt records the outgoing API body, not just your chat message.
        Headers, API keys and endpoint URLs are excluded; recognizable
        secrets/contact fields are redacted. Large payloads are capped. Logs can
        still contain sensitive store content: administrators only. Browser
        Ollama logs are best-effort, client-reported diagnostics. No records
        exist for requests made before logging was enabled.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {[
                "Time / request",
                "Provider / requested model",
                "API result",
                "Input / output",
                "Duration",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="whitespace-nowrap p-3 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-3">
                  <p>{date(row.created_at)}</p>
                  <p
                    className="mt-1 font-mono text-[11px] text-muted-foreground"
                    title={row.trace_id}
                  >
                    {row.trace_id.slice(0, 8)} · {row.source}
                  </p>
                </td>
                <td className="max-w-64 p-3">
                  <p className="capitalize">{row.provider}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {row.model}
                  </p>
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${row.status === "error" ? "bg-destructive/10 text-destructive" : row.status === "success" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {row.status === "pending"
                      ? "Pending / incomplete"
                      : row.status === "success"
                        ? "HTTP success"
                        : "Failed"}
                    {row.http_status ? ` · ${row.http_status}` : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap p-3 text-xs tabular-nums">
                  {counts(row.input_tokens)} / {counts(row.output_tokens)}
                </td>
                <td className="whitespace-nowrap p-3 tabular-nums">
                  {row.duration_ms == null
                    ? "—"
                    : `${(row.duration_ms / 1000).toFixed(2)}s`}
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      isDisabled={busy}
                      onPress={() =>
                        run(async () => {
                          const loaded = await getAiLogDetail(row.id);
                          if (!loaded)
                            throw new Error(
                              "This log was deleted or has expired.",
                            );
                          setDetail(loaded);
                        })
                      }
                    >
                      <ScanTextIcon />
                      Details
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete log"
                      isDisabled={busy}
                      onPress={() => remove(row.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-10 text-center text-muted-foreground"
                >
                  No AI logs yet. New AI requests will appear here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2">
          Per page
          <select
            className="rounded-md border bg-background p-2"
            value={per}
            onChange={(e) => router.push(`/nemesis/logs?per=${e.target.value}`)}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-4">
          {page > 1 ? (
            <Link
              className="text-primary"
              href={`/nemesis/logs?per=${per}&page=${page - 1}`}
            >
              Previous
            </Link>
          ) : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              className="text-primary"
              href={`/nemesis/logs?per=${per}&page=${page + 1}`}
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
      {detail ? (
        <Dialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
          showCloseButton={false}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>AI API request details</DialogTitle>
              <Button variant="ghost" size="sm" onPress={() => setDetail(null)}>
                Close
              </Button>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              Request group: {detail.trace_id} · Actor:{" "}
              {detail.actor_id ?? "Deleted account"} · Source: {detail.source}
            </p>
            <p className="text-xs text-muted-foreground">
              The data below is the captured outgoing body after privacy
              filtering—not provider-hidden instructions. The redacted/truncated
              flags describe any changes. Token counts come from provider
              responses; they are not estimated from this preview. A missing
              response can mean the request was interrupted or its log update
              failed.
            </p>
            {[
              ["Input sent to API", detail.request_payload],
              ["API response / error", detail.response_payload],
            ].map(([label, payload]) => (
              <div key={String(label)}>
                <h3 className="mb-2 text-sm font-medium">{String(label)}</h3>
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
