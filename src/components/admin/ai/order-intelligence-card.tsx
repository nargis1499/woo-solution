"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardListIcon, DownloadIcon } from "lucide-react";
import { OrderAlerts } from "./order-alerts";
import { orderAlertCopy } from "@/lib/ai/orders/alert-copy";
import { parseOrderPaymentInfo } from "@/lib/order-payment";
import { formatMoney, USD_MONEY } from "@/lib/money";
import type { AiOrderIntelligenceWidget, OrderReport, OrderRow } from "@/lib/ai/orders/types";

const money = (n: number) => formatMoney(n, USD_MONEY);
const date = (v?: string | null) => v ? new Date(v).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Not recorded";
const percent = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : "N/A";
const change = (n: number, prev: number) => prev ? `${((n - prev) * 100 / prev).toFixed(1)}% vs previous period` : n ? "New activity (previous period: 0)" : "No change (both periods: 0)";
const button = "cursor-pointer rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted disabled:cursor-wait disabled:opacity-50";
function safeTracking(url?: string | null) {
  try { return url && new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}
function csvCell(value: unknown) {
  const text = String(value ?? "");
  return '"' + (/^(?:\s*[=+\-@]|[\t\r\n])/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
}
function exportPage(report: OrderReport, summaryAsOf: string) {
  const data = [
    ["Report", report.mode, "Page data UTC", report.generatedAt, "Summary data UTC", summaryAsOf, "Scope", "CURRENT LOADED PAGE ONLY", "Filters", JSON.stringify(report.filters)],
    ["Order", "Created UTC", "Customer", "Status", "Payment", "Fulfillment", "Shipping", "Quantity", "Total USD", "Problems"],
    ...report.rows.map(o => [o.order_number, o.created_at, o.shipping_name, o.status, o.payment_status, o.fulfillment_status, o.shipping_status, o.quantity, (o.total_micros / 1000000).toFixed(2), o.flags.map(f => orderAlertCopy(f, o).title).join("; ")]),
    ...(report.metrics ? [["METRICS FOR ALL MATCHING ORDERS"], ["Orders", report.metrics.orders, "Paid orders", report.metrics.paidOrders, "Paid revenue USD", report.metrics.revenueMicros / 1000000, "AOV USD", report.metrics.aovMicros / 1000000]] : []),
  ];
  const url = URL.createObjectURL(new Blob(["\uFEFF" + data.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `orders-${report.generatedAt.slice(0, 10)}-loaded-page.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function OrderDetails({ order: o }: { order: OrderRow }) {
  const tracking = safeTracking(o.tracking_url);
  const payment = parseOrderPaymentInfo({ ...o, notes: o.notes ?? null });
  return <div className="space-y-3 rounded-lg border bg-muted/15 p-3 text-xs">
    <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">Order #{o.order_number}</h4><Link href={`/nemesis/orders/${o.id}`} className="text-primary underline">Open order</Link></div>
    <p>{o.shipping_name} · {o.customer_email || "No email recorded"}</p>
    <p className="text-muted-foreground">{[o.shipping_address_line1, o.shipping_address_line2, o.shipping_city, o.shipping_postal_code, o.shipping_country].filter(Boolean).join(", ")} {o.shipping_phone ? `· ${o.shipping_phone}` : ""}</p>
    <p>{o.status} · Payment: {o.payment_status} ({payment.methodLabel}) · Fulfillment: {o.fulfillment_status} · Shipping: {o.shipping_status}</p>
    <OrderAlerts order={o}/>
    <dl className="grid grid-cols-2 gap-2 rounded-md border p-2">
      {[ ["Subtotal (USD)", o.subtotal_micros == null ? "Not recorded" : money(o.subtotal_micros)], ["Shipping (USD)", o.shipping_micros == null ? "Not recorded" : money(o.shipping_micros)], ["Discount", "Not separately recorded"], ["Tax", "Not separately recorded"], ["Total (USD)", money(o.total_micros)], ["Checkout currency / rate", `${o.currency ?? "Unknown"} / ${o.exchange_rate ?? "Unknown"}`] ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <ul className="divide-y rounded-md border px-2">{o.items?.map(i => <li key={i.id} className="py-2"><p className="font-medium">{i.product_name} {i.variation_label && <span className="text-muted-foreground">· {i.variation_label}</span>}</p><p>{i.quantity} × {money(i.unit_price_micros)} = {money(i.line_total_micros)}</p>{i.variation_id && <p className="break-all text-[10px] text-muted-foreground">Variant: {i.variation_id}</p>}</li>)}</ul>
    <p>Tracking: {o.shipping_carrier || "No carrier"} · {o.tracking_number || "Not recorded"} {tracking && <a className="text-primary underline" target="_blank" rel="noopener noreferrer" href={tracking}>Carrier tracking</a>}</p>
    <p>Refund request: {o.refund_request_status || "none"} · {date(o.refund_requested_at)}</p>
    {payment.customerNotes && <p className="whitespace-pre-wrap">Customer checkout notes: {payment.customerNotes}</p>}
    {(payment.isCrypto || payment.isPlisio) && <details><summary className="cursor-pointer">Payment transaction details</summary><p className="mt-2 break-all">{[payment.protocolName, payment.network, payment.depositAddress, payment.transactionId, payment.plisioTxnId, payment.cryptoAmount].filter(Boolean).join(" · ")}</p></details>}
    <details><summary className="cursor-pointer font-medium">Timestamps & timeline</summary><dl className="mt-2 grid grid-cols-2 gap-2">{[["Created", o.created_at], ["Last update", o.updated_at], ["Paid", o.paid_at], ["Fulfilled", o.fulfilled_at], ["Shipped", o.shipped_at], ["Delivered", o.delivered_at], ["Fulfillment due", o.fulfillment_due_at], ["Expected delivery", o.expected_delivery_at]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{date(value)}</dd></div>)}</dl>
      <ol className="mt-3 space-y-2 border-l pl-3">{o.timeline?.map(e => <li key={e.id}><p className={e.success ? "font-medium" : "font-medium text-destructive"}>{e.event} {e.success ? "" : "— failed"} · {date(e.created_at)}</p><p className="whitespace-pre-wrap break-words text-muted-foreground">{e.message}</p></li>)}</ol>
      <p className="mt-2 text-[10px] text-muted-foreground">Showing the latest {o.timeline?.length ?? 0} of {o.timelineCount ?? 0} recorded events, newest first. Events before Order Intelligence was installed may be unavailable. Internal notes and audit events are admin-only.</p>
    </details>
  </div>;
}

export function OrderIntelligenceCard({ widget }: { widget: AiOrderIntelligenceWidget }) {
  const [page, setPage] = useState<OrderReport>(widget);
  const [history, setHistory] = useState<Array<Record<string, string | number | boolean>>>([]);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<OrderRow | null>(null);
  const [customerReport, setCustomerReport] = useState<OrderReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const metrics = widget.metrics;
  const rows = expanded ? page.rows : page.rows.slice(0, widget.initialVisibleRows);

  async function fetchReport(mode: OrderReport["mode"], filters: Record<string, string | number | boolean>) {
    const res = await fetch("/api/nemesis/ai/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, filters }) });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Report unavailable.");
    return data.report as OrderReport;
  }
  async function navigate(previous = false) {
    setBusy(true); setError("");
    try {
      const last = page.rows.at(-1);
      if (!previous && !last) return;
      const filters = previous ? history[history.length - 1] : { ...page.filters, cursorAt: last!.created_at, cursorId: last!.id, cursorSeverity: last!.flags.some(f => f.severity === "high") ? 0 : 1 };
      const result = await fetchReport(widget.mode === "problems" ? "problems" : "search", filters);
      setHistory(previous ? history.slice(0, -1) : [...history, page.filters]); setPage(result); setExpanded(false); setDetail(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load page."); } finally { setBusy(false); }
  }
  async function inspect(id: string, customer = false) {
    setBusy(true); setError("");
    try {
      const report = await fetchReport(customer ? "customers" : "detail", customer ? { customerOrderId: id, limit: 20 } : { id });
      if (customer) setCustomerReport(report); else setDetail(report.rows[0] ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to inspect order."); } finally { setBusy(false); }
  }
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-xs shadow-xs" aria-label="Order Management Intelligence report">
    <header className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><ClipboardListIcon className="size-5 text-primary"/><div><h3 className="text-sm font-semibold">Order Management Intelligence</h3><p className="text-muted-foreground">{widget.mode} · {date(widget.generatedAt)}</p></div></div><button type="button" className={button} onClick={() => exportPage({ ...page, mode: widget.mode, metrics }, widget.generatedAt)}><DownloadIcon className="mr-1 inline size-3"/>Export loaded page CSV</button></header>
    <p className="break-words text-[11px] text-muted-foreground">{widget.filters.from ? date(String(widget.filters.from)) : "All recorded history"} → {date(String(widget.filters.to))} (end exclusive). Amounts below are base USD, not mixed checkout currencies.</p>
    <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">Report filters & thresholds</summary><dl className="mt-2 grid grid-cols-2 gap-1">{Object.entries(widget.filters).filter(([k]) => !k.startsWith("cursor")).map(([k,v]) => <div key={k}><dt>{k}</dt><dd className="break-all font-medium text-foreground">{String(v)}</dd></div>)}</dl></details>
    {metrics && <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Matching orders", metrics.orders], ["Eligible paid revenue", money(metrics.revenueMicros)], ["Paid-order AOV", money(metrics.aovMicros)], ["Eligible paid orders", metrics.paidOrders], ["Cancellation rate", percent(metrics.cancelled, metrics.orders)], ["Refunded-order rate", percent(metrics.refunded, metrics.orders)], ["Repeat / one-time buyers", `${metrics.repeatCustomers} / ${metrics.oneTimeCustomers}`], ["Inactive buyers", metrics.inactiveCustomers]].map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/20 p-2"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>
      {(widget.filters.inactiveOnly || widget.filters.repeatOnly || widget.filters.highRiskOnly) && <div className="space-y-1 rounded-md border bg-muted/20 p-2"><p className="font-medium">Selected customer cohort: {metrics.cohortCustomers} customers · {metrics.cohortOrders} orders · {metrics.cohortPurchases} paid purchases · {money(metrics.cohortSpendingMicros)} paid spending</p><p className="text-[10px] text-muted-foreground">Customer switches filter this cohort and the customer list. Base order totals and underlying rows retain the date/order filters, not the customer switches.</p></div>}
      {widget.mode === "report" && <p className="text-[11px] text-muted-foreground">Equal-length previous period: {metrics.previousOrders} orders / {money(metrics.previousRevenueMicros)}. Orders {change(metrics.orders, metrics.previousOrders)}; revenue {change(metrics.revenueMicros, metrics.previousRevenueMicros)}. Changes of ±25% or more deserve review; small counts can be noisy.</p>}
      {widget.mode === "report" && ((metrics.previousOrders > 0 && Math.abs(metrics.orders / metrics.previousOrders - 1) >= 0.25) || (metrics.previousRevenueMicros > 0 && Math.abs(metrics.revenueMicros / metrics.previousRevenueMicros - 1) >= 0.25)) && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">Review recommended: order volume or paid revenue changed by at least 25% versus the equal-length previous period. This is a fixed review-threshold alert, not statistical significance or proof of a problem.</p>}
      <div className="grid gap-2 sm:grid-cols-3">{[["Order status", metrics.statusCounts], ["Recorded payment status", metrics.paymentCounts], ["Fulfillment", metrics.fulfillmentCounts]].map(([label, counts]) => <div key={String(label)} className="rounded-lg border p-2"><h4 className="font-medium">{String(label)}</h4><ul className="mt-1 text-muted-foreground">{Object.entries(counts ?? {}).map(([k,v]) => <li key={k} className="flex justify-between gap-2"><span>{k}</span><span>{String(v)}</span></li>)}</ul></div>)}</div>
      <p className="text-[10px] text-muted-foreground">Revenue excludes unpaid, refunded and cancelled orders. Rates count orders, not refund amounts or gateway attempts; actual payment success/failure rates are unavailable. Customer spending/frequency uses only this history window. Guest orders without email cannot be linked across purchases.</p>
    </>}
    {widget.daily.length > 0 && <details><summary className="cursor-pointer font-medium">Daily order volume (latest 60 active UTC days)</summary><div className="mt-2 max-h-64 space-y-1 overflow-auto">{widget.daily.map(d => <div key={d.day} className="grid grid-cols-[80px_1fr_90px] items-center gap-2 text-[10px]"><span>{d.day}</span><div className="flex items-center gap-1"><span className="h-2 rounded bg-primary/70" style={{ width: `${Math.max(1, d.orders / Math.max(...widget.daily.map(x => x.orders)) * 100)}%` }}/><span>{d.orders}</span></div><span className="text-right">{money(d.revenue)}</span></div>)}</div></details>}
    {[["Best-selling products", widget.topProducts], ["Highest-revenue products (gross item sales)", widget.highestRevenueProducts]].map(([title, products]) => typeof products !== "string" && products.length > 0 && <details key={String(title)}><summary className="cursor-pointer font-medium">{String(title)}</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr className="text-muted-foreground"><th>Product</th><th>Units</th><th>Item sales USD</th></tr></thead><tbody>{products.map(p => <tr key={p.key} className="border-t"><td className="py-2">{p.name}</td><td>{p.units}</td><td>{money(p.sales)}</td></tr>)}</tbody></table></div></details>)}
    {widget.customers.length > 0 && <details><summary className="cursor-pointer font-medium">Top / matching customers (up to 20)</summary><div className="mt-2 space-y-2">{widget.customers.map(c => <div key={c.key} className="rounded-md border p-2"><div className="flex items-center justify-between gap-2"><p className="font-medium">{c.name} · {money(c.spending)}</p><button type="button" className={button} disabled={busy} onClick={() => inspect(c.sample_order_id, true)}>Purchase history</button></div><p className="mt-1 text-muted-foreground">{c.purchases} paid purchases / {c.orders} orders · {c.cancellations} cancelled · {c.refunds} refunded{c.cancellations >= 3 || c.refunds >= 2 ? " · Repeated cancellation/refund activity: review before further fulfillment" : ""}</p><p className="text-muted-foreground">Last purchase: {date(c.last_purchase)} · {c.frequency_days == null ? "No repeat interval yet" : `${Number(c.frequency_days).toFixed(1)} days between paid purchases on average`}</p></div>)}</div></details>}
    {widget.combinations.length > 0 && <details><summary className="cursor-pointer font-medium">Frequently bought together</summary><ul className="mt-2 space-y-1 text-muted-foreground">{widget.combinations.map(c => <li key={`${c.first}-${c.second}`}>{c.first} + {c.second}: {c.orders} paid orders</li>)}</ul></details>}
    {customerReport && <div className="space-y-2 rounded-lg border bg-muted/15 p-3"><div className="flex items-center justify-between"><h4 className="font-medium">Customer all-history purchase summary</h4><button type="button" className={button} onClick={() => setCustomerReport(null)}>Close</button></div><p>{customerReport.metrics?.orders ?? 0} orders · {money(customerReport.metrics?.revenueMicros ?? 0)} eligible paid spending</p>{customerReport.rows.map(o => <div key={o.id} className="flex justify-between gap-2"><Link className="text-primary underline" href={`/nemesis/orders/${o.id}`}>#{o.order_number} · {date(o.created_at)}</Link><span>{o.status} · {money(o.total_micros)}</span></div>)}{customerReport.hasMore && <p className="text-muted-foreground">Showing the first 20 orders. Ask Nemesis for this customer’s purchase history to browse further pages.</p>}</div>}
    {widget.mode === "detail" ? page.rows.map(o => <OrderDetails key={o.id} order={o}/>) : <>
      <h4 className="font-medium">{widget.mode === "problems" ? "Orders to review (highest priority, then oldest first)" : "Underlying orders"}</h4>
      <p className="text-[10px] text-muted-foreground">{widget.mode === "problems" ? `${widget.total} orders scanned; shown rows are flagged matches only.` : `${widget.total} total matching orders.`} Loaded page: {page.rows.length} rows, fetched {date(page.generatedAt)}. Read-only snapshot; refresh before acting.</p>
      {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-muted-foreground">No matching orders or alerts in this scope.</p>}
      <div className="space-y-2">{rows.map(o => <article key={o.id} className="space-y-2 rounded-lg border bg-muted/10 p-3"><div className="flex flex-wrap justify-between gap-2"><div><Link className="font-semibold text-primary hover:underline" href={`/nemesis/orders/${o.id}`}>Order #{o.order_number}</Link><p className="text-muted-foreground">{o.shipping_name} · {money(o.total_micros)} · {o.quantity} units</p></div><button type="button" className={button} disabled={busy} onClick={() => inspect(o.id)}>Inspect details</button></div><p className="text-[11px] text-muted-foreground">{o.status} · {o.payment_status} · {o.fulfillment_status} / {o.shipping_status} · {date(o.created_at)}</p><OrderAlerts order={o}/></article>)}</div>
      {page.rows.length > widget.initialVisibleRows && <button type="button" className={button} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer loaded orders" : `Show all ${page.rows.length} loaded orders`}</button>}
      <div className="flex items-center justify-between gap-2"><button type="button" disabled={busy || history.length === 0} className={button} onClick={() => navigate(true)}>Previous page</button><span className="text-[10px] text-muted-foreground">Page {history.length + 1} · no AI tokens for browsing</span><button type="button" disabled={busy || !page.hasMore} className={button} onClick={() => navigate()}>Next page</button></div>
    </>}
    {detail && <div className="space-y-2"><button type="button" className={button} onClick={() => setDetail(null)}>Close detail</button><OrderDetails order={detail}/></div>}
    {busy && <p role="status" className="text-muted-foreground">Loading live order data…</p>}
    {error && <p role="alert" className="rounded-md border border-destructive/30 p-2 text-destructive">{error}</p>}
    <p className="text-[10px] text-muted-foreground">No changes made by this report. Operations require an explicit approval preview; refund requests are not money transfers.</p>
  </section>;
}
