"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, USD_MONEY } from "@/lib/money";
import { browseCustomerIntelligence } from "@/app/nemesis/ai-actions";
import type {
  AiCustomerIntelligenceWidget,
  CustomerMode,
  CustomerReport,
} from "@/lib/ai/customers/types";
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString("en-GB", { timeZone: "UTC" })
    : "Not recorded";
const boundary = (v: string | number | null) =>
  new Date(String(v)).toLocaleString("en-GB", { timeZone: "UTC" });
const money = (n: number) => formatMoney(n, USD_MONEY);
export function CustomerIntelligenceCard({
  widget,
}: {
  widget: AiCustomerIntelligenceWidget;
}) {
  const [report, setReport] = useState<CustomerReport>(widget);
  const [inspection, setInspection] = useState<CustomerReport | null>(null);
  const [visible, setVisible] = useState(widget.initialVisibleRows);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const [search, setSearch] = useState(String(widget.filters.search ?? ""));
  function browse(
    mode: CustomerMode,
    filters: Record<string, unknown>,
    inspect = false,
  ) {
    setError("");
    start(async () => {
      const result = await browseCustomerIntelligence(mode, filters);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (inspect) setInspection(result.report);
      else {
        setReport(result.report);
        setInspection(null);
        setVisible(widget.initialVisibleRows);
      }
    });
  }
  function pages(r: CustomerReport, inspect = false) {
    const page = Number(r.filters.page),
      limit = Number(r.filters.limit),
      totalPages = Math.max(1, Math.ceil(r.total / limit));
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
        <label>
          Per page{" "}
          <select
            aria-label={
              inspect
                ? "Customer history page size"
                : "Customer report page size"
            }
            className="rounded border bg-background p-1"
            value={limit}
            disabled={busy}
            onChange={(e) =>
              browse(
                r.mode,
                { ...r.filters, limit: Number(e.target.value), page: 1 },
                inspect,
              )
            }
          >
            {[
              5,
              10,
              20,
              50,
              ...(![5, 10, 20, 50].includes(limit) ? [limit] : []),
            ]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            isDisabled={busy || page <= 1}
            onPress={() =>
              browse(r.mode, { ...r.filters, page: page - 1 }, inspect)
            }
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages} · {r.total} matching
          </span>
          <Button
            variant="outline"
            size="sm"
            isDisabled={busy || page >= totalPages || page >= 10000}
            onPress={() =>
              browse(r.mode, { ...r.filters, page: page + 1 }, inspect)
            }
          >
            Next
          </Button>
        </div>
      </div>
    );
  }
  const m = report.metrics;
  const list = report.mode === "history" ? report.history : report.rows;
  return (
    <section
      aria-busy={busy}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <UsersIcon className="size-5 text-primary" />
        <h3 className="font-semibold">Customer Intelligence</h3>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
          Read-only · {report.mode}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Order dates: {boundary(report.filters.from)} →{" "}
        {boundary(report.filters.to)} (end exclusive), UTC · Current recorded
        statuses · Base USD
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["Matching customers", m.customers],
          ["Buyers in window", m.buyers],
          ["Completed paid purchases", m.purchases],
          ["Window spending", money(m.spending)],
          ["Repeat buyers in window", m.repeat_buyers],
          ["First-time buyers", m.new_buyers],
          ["Returning buyers", m.returning_buyers],
          [
            "Average qualifying order",
            m.aov == null ? "No purchases" : money(m.aov),
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border bg-muted/15 p-2"
          >
            <p className="text-muted-foreground">{label}</p>
            <p className="mt-1 font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {m.inactive_buyers} past buyers inactive for{" "}
        {report.filters.inactiveDays}+ days · {m.not_converted} matching
        identities without a completed paid purchase. Neither inactivity nor
        cancellation/refund activity proves churn or fraud.
      </p>
      {!["details", "history"].includes(report.mode) && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            browse(report.mode, { ...report.filters, search, page: 1 });
          }}
        >
          <input
            aria-label="Search customer name or email"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-xs"
            placeholder="Search recorded name or email…"
            maxLength={120}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" isDisabled={busy}>
            Search
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {report.mode === "history" ? (
        <div className="space-y-2">
          {report.history.slice(0, visible).map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap justify-between gap-2 rounded-lg border p-2 text-xs"
            >
              <Link
                className="text-primary underline"
                href={`/nemesis/orders/${o.id}`}
              >
                #{o.order_number} · {date(o.created_at)}
              </Link>
              <span>
                {o.status} · {o.payment_status} · {money(o.total_micros)}
                {o.eligible ? " · Qualifying purchase" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {report.rows.slice(0, visible).map((c) => (
            <article
              key={c.key}
              className="space-y-2 rounded-lg border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">{c.name}</h4>
                <span className="text-muted-foreground">
                  {c.identity.replaceAll("_", " ")}
                </span>
              </div>
              <p>
                {c.window_purchases} window purchases ·{" "}
                {money(c.window_spending)} window spending
              </p>
              <p className="text-muted-foreground">
                Lifetime as of cutoff: {c.purchases} completed paid purchases /{" "}
                {c.orders} total orders · {money(c.spending)} · First{" "}
                {date(c.first_purchase)} · Last {date(c.last_purchase)}
              </p>
              <p className="text-muted-foreground">
                {c.cancellations} cancelled · {c.refunds} marked refunded ·
                Signup {date(c.registered_at)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy}
                  onPress={() =>
                    browse(
                      "details",
                      {
                        customerKey: c.key,
                        to: report.filters.to,
                        page: 1,
                        limit: 1,
                      },
                      true,
                    )
                  }
                >
                  Customer details
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy}
                  onPress={() =>
                    browse(
                      "history",
                      {
                        customerKey: c.key,
                        to: report.filters.to,
                        page: 1,
                        limit: 10,
                      },
                      true,
                    )
                  }
                >
                  All purchase history
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!list.length && (
        <p className="text-sm text-muted-foreground">
          No matching records for this scope.
        </p>
      )}
      {visible < list.length && (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setVisible(list.length)}
        >
          Show remaining loaded rows ({list.length - visible})
        </Button>
      )}
      {report.detail && (
        <div className="rounded-lg border bg-muted/10 p-3 text-xs">
          <p>
            {report.detail.email ?? "No email recorded"} ·{" "}
            {report.detail.phone ?? "No phone recorded"}
          </p>
          <p className="mt-1">
            {report.detail.address ?? "No address recorded"}
          </p>
          <p className="mt-2 text-muted-foreground">
            {report.detail.contactSource}
          </p>
        </div>
      )}
      {report.mode !== "details" && pages(report)}
      {inspection && (
        <div className="space-y-3 rounded-lg border border-primary/25 p-3 text-xs">
          <div className="flex justify-between gap-2">
            <h4 className="font-semibold">
              {inspection.mode === "details"
                ? "Customer details"
                : "Customer purchase history"}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setInspection(null)}
            >
              Close
            </Button>
          </div>
          {inspection.rows[0] && (
            <p>
              {inspection.rows[0].name} · {inspection.rows[0].purchases}{" "}
              lifetime completed paid purchases ·{" "}
              {money(inspection.rows[0].spending)}
            </p>
          )}
          {inspection.detail ? (
            <div className="space-y-1">
              <p>
                {inspection.detail.email ?? "No email"} ·{" "}
                {inspection.detail.phone ?? "No phone"}
              </p>
              <p>{inspection.detail.address ?? "No recorded address"}</p>
              <p className="text-muted-foreground">
                {inspection.detail.contactSource}
              </p>
            </div>
          ) : (
            inspection.history.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap justify-between gap-2 border-t pt-2"
              >
                <Link
                  className="text-primary underline"
                  href={`/nemesis/orders/${o.id}`}
                >
                  #{o.order_number} · {date(o.created_at)}
                </Link>
                <span>
                  {o.status} · {o.payment_status} · {money(o.total_micros)}
                </span>
              </div>
            ))
          )}
          {inspection.mode === "history" && pages(inspection, true)}
          {inspection.total === 0 && (
            <p>No records found; this identity may no longer exist.</p>
          )}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Purchases and spending require completed AND paid orders. New buyers use
        the first lifetime qualifying order’s placement date, not signup or
        verified conversion time. Guest email groups are unverified and stay
        separate from registered identities. Totals cover the full matching
        cohort; lifetime values stop at the cutoff. Contact details appear only
        in admin details, not AI summaries.
      </p>
    </section>
  );
}
