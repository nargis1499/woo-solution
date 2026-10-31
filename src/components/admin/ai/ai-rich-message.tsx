"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  BoxesIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  MessageSquareIcon,
  PackageIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TrendingUpIcon,
} from "lucide-react";
import type { AiToolBadge, AiUiWidget } from "@/lib/ai/types";
import { InventoryIntelligenceCard } from "./inventory-intelligence-card";
import { cn } from "@/lib/utils";

/* ── 1. Collapsible Tool Operations Accordion ────────────────────────────── */

function splitToolSummary(summary: string): { fn: string; args: string } {
  const idx = summary.indexOf("(");
  if (idx === -1) return { fn: summary, args: "" };
  return {
    fn: summary.slice(0, idx).trim(),
    args: summary.slice(idx).trim(),
  };
}

export function ToolOperationsAccordion({ badges }: { badges: AiToolBadge[] }) {
  const [expanded, setExpanded] = useState(true);

  if (badges.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card/60 text-xs shadow-2xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between border-b border-transparent bg-muted/40 px-3.5 py-2 text-muted-foreground transition-colors hover:bg-muted/70 data-[open=true]:border-border/60"
        data-open={expanded || undefined}
      >
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="font-medium text-foreground">
            Executed {badges.length} Tool {badges.length === 1 ? "Operation" : "Operations"}
          </span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span>{expanded ? "Hide details" : "Show details"}</span>
          {expanded ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-1.5 bg-muted/15 p-2.5 font-mono text-[11px]">
          {badges.map((b) => {
            const { fn, args } = splitToolSummary(b.summary);
            return (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-lg border bg-background/85 px-2.5 py-1.5"
              >
                <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />
                <span className="font-medium text-primary">{fn}</span>
                {args && <span className="truncate text-muted-foreground">{args}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 2. Structured Read-Tool Dashboard Widgets ───────────────────────────── */

export function AiWidgetCard({ widget }: { widget: AiUiWidget }) {
  if (widget.kind === "inventory_intelligence") return <InventoryIntelligenceCard widget={widget} />;
  if (widget.kind === "inventory") {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <BoxesIcon className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">{widget.title}</h3>
          </div>
          {widget.attentionCount > 0 ? (
            <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {widget.attentionCount}{" "}
              {widget.attentionCount === 1 ? "Item Needs Attention" : "Items Need Attention"}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {widget.matchedCount} {widget.matchedCount === 1 ? "Product" : "Products"}
            </span>
          )}
        </div>

        {widget.items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/25 px-3.5 py-4 text-center text-xs text-muted-foreground">
            No products matched this filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 pt-0.5 sm:grid-cols-2">
            {widget.items.map((item) => {
              const stockTone =
                item.stockManaged === false ? "border-primary/20 bg-primary/10 text-primary" : item.stock <= 0
                  ? "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : item.stock <= 3
                    ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
              const stockLabel =
                item.stockManaged === false ? "Unlimited stock" : item.stock <= 3 ? `${item.stock} remaining` : `${item.stock} in stock`;

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-2.5 rounded-lg border bg-muted/20 p-3 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="size-8 shrink-0 rounded-md border bg-muted object-cover"
                        />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                          <PackageIcon className="size-3.5" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {item.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>Category:</span>
                          <span className="font-medium text-foreground/85">
                            {item.category ?? "Uncategorized"}
                          </span>
                          {item.status === "draft" && (
                            <span className="rounded border bg-muted px-1.5 py-0.2 text-[10px]">
                              Draft
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right font-mono">
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {item.price}
                      </span>
                      {item.compareAtPrice && (
                        <div className="text-[10px] text-muted-foreground line-through">
                          {item.compareAtPrice}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/70 pt-2">
                    <span className="text-[11px] text-muted-foreground">Stock Count:</span>
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[11px] font-semibold",
                        stockTone,
                      )}
                    >
                      {stockLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {widget.matchedCount > widget.items.length && (
          <p className="text-[11px] text-muted-foreground">
            Showing {widget.items.length} of {widget.matchedCount} matched products.
          </p>
        )}
      </div>
    );
  }

  if (widget.kind === "analytics") {
    return (
      <div className="space-y-3.5 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <BarChart3Icon className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Store Performance ({widget.windowDays}-Day Summary)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Live revenue, order pipeline &amp; catalog health
              </p>
            </div>
          </div>
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-primary">
            All-Time: {widget.revenueAllTime}
          </span>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {widget.windowDays}d Revenue
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              {widget.revenueWindow}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {widget.windowDays}d Orders
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-foreground">
              {widget.ordersInWindow}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              30d Revenue
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-foreground">
              {widget.revenue30d}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Active Catalog
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-foreground">
              {widget.catalogHealth.activeProducts}/{widget.catalogHealth.totalProducts}
            </div>
          </div>
        </div>

        {/* Order Status Strip */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/15 px-3 py-2 text-[11px]">
          <span className="font-medium text-muted-foreground">Orders:</span>
          <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-amber-700 dark:text-amber-300">
            {widget.ordersByStatus.pending} Pending
          </span>
          <span className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 font-mono text-sky-700 dark:text-sky-300">
            {widget.ordersByStatus.processing} Processing
          </span>
          <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-700 dark:text-emerald-300">
            {widget.ordersByStatus.completed} Completed
          </span>
          {widget.catalogHealth.activeOutOfStock > 0 && (
            <span className="ml-auto rounded border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-700 dark:text-rose-300">
              {widget.catalogHealth.activeOutOfStock} Out of Stock
            </span>
          )}
        </div>

        {/* Top Products & Pending Orders */}
        {(widget.topProducts.length > 0 || widget.pendingOrders.length > 0) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {widget.topProducts.length > 0 && (
              <div className="rounded-lg border bg-muted/15 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <TrendingUpIcon className="size-3.5 text-primary" />
                  Top Products ({widget.windowDays}d)
                </div>
                <div className="divide-y divide-border/60 text-xs">
                  {widget.topProducts.map((tp) => (
                    <div
                      key={tp.name}
                      className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0"
                    >
                      <span className="truncate font-medium text-foreground">{tp.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {tp.unitsSold}u ·{" "}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {tp.revenue}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {widget.pendingOrders.length > 0 && (
              <div className="rounded-lg border bg-muted/15 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ShoppingCartIcon className="size-3.5 text-amber-500" />
                  Pending Orders
                </div>
                <div className="divide-y divide-border/60 text-xs">
                  {widget.pendingOrders.map((po) => (
                    <div
                      key={po.orderNumber}
                      className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0"
                    >
                      <span className="truncate text-foreground">
                        <span className="font-mono font-semibold">{po.orderNumber}</span> ·{" "}
                        {po.customer}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-foreground">
                        {po.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3.5 text-xs">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <ShieldCheckIcon className="size-4" />
      </span>
      <div>
        <p className="font-semibold text-foreground">Store SEO Audit Passed</p>
        <p className="text-muted-foreground">
          All audited {widget.scope === "all" ? "products, pages, posts & media" : widget.scope}{" "}
          already have descriptions and alt text populated.
        </p>
      </div>
    </div>
  );
}

/* ── 3. Theme-Adaptive Rich Message Renderer (Zero Raw Markdown) ─────────── */

function renderInlineFormatted(text: string): ReactNode[] {
  const cleaned = text.replace(/^⚠️\s*/, "");
  const tokens = cleaned.split(
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\n]+\*)/g,
  );
  return tokens.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:opacity-85"
        >
          {linkMatch[1]}
        </a>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={idx} className="italic text-foreground/90">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

type ParsedBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "alert"; text: string }
  | { kind: "paragraph"; text: string };

function parseRichBlocks(raw: string): ParsedBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || /^---+$/.test(trimmed)) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, code: buf.join("\n") });
      continue;
    }

    // Markdown table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const splitRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Heading (#, ##, ### or standalone **Heading** line)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      const cleanHeading = headingMatch[2].replace(/^\*\*|\*\*$/g, "").trim();
      blocks.push({ kind: "heading", level, text: cleanHeading });
      i++;
      continue;
    }
    const boldHeadingMatch = trimmed.match(/^\*\*([^*]{3,80})\*\*$/);
    if (boldHeadingMatch) {
      blocks.push({ kind: "heading", level: 3, text: boldHeadingMatch[1].trim() });
      i++;
      continue;
    }

    // Warning / error / blockquote alert
    if (trimmed.startsWith("⚠️") || trimmed.startsWith("> ")) {
      blocks.push({
        kind: "alert",
        text: trimmed.replace(/^>\s*/, "").trim(),
      });
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph (coalesce consecutive plain lines)
    const para: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,3}\s|[-*•]\s|\d+[.)]\s|>\s|⚠️)/.test(lines[i].trim()) &&
      !(
        lines[i].includes("|") &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
      )
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

export function RichAiMessage({
  content,
  hasStructuredCards,
  usedFallback,
  modelUsed,
}: {
  content: string;
  hasStructuredCards: boolean;
  usedFallback?: boolean;
  modelUsed?: string;
}) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const blocks = parseRichBlocks(trimmed);
  if (blocks.length === 0) return null;

  // Compact conversational footer note when structured UI cards already show the main payload
  if (
    hasStructuredCards &&
    blocks.length === 1 &&
    blocks[0].kind === "paragraph" &&
    blocks[0].text.length <= 240
  ) {
    return (
      <div className="flex items-start gap-2 pt-0.5 text-xs text-muted-foreground">
        <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <div>
          <span>{renderInlineFormatted(blocks[0].text)}</span>
          {usedFallback && modelUsed && (
            <span className="ml-2 text-[11px] opacity-75">· Fallback ({modelUsed})</span>
          )}
        </div>
      </div>
    );
  }

  // Error-only alert banner
  if (blocks.length === 1 && blocks[0].kind === "alert" && trimmed.startsWith("⚠️")) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-destructive/35 bg-destructive/[0.07] p-3.5 text-xs text-destructive">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <span className="leading-relaxed">{renderInlineFormatted(blocks[0].text)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground shadow-2xs">
      {blocks.map((block, idx) => {
        if (block.kind === "heading") {
          return (
            <h4
              key={idx}
              className={cn(
                "font-semibold tracking-tight text-foreground",
                block.level === 1 ? "text-sm" : "text-xs",
                idx > 0 && "pt-1",
              )}
            >
              {renderInlineFormatted(block.text)}
            </h4>
          );
        }

        if (block.kind === "ul") {
          return (
            <ul key={idx} className="space-y-1.5">
              {block.items.map((item, liIdx) => (
                <li
                  key={liIdx}
                  className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-foreground/90"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">{renderInlineFormatted(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === "ol") {
          return (
            <ol key={idx} className="space-y-1.5">
              {block.items.map((item, liIdx) => (
                <li
                  key={liIdx}
                  className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-foreground/90"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
                    {liIdx + 1}
                  </span>
                  <span className="min-w-0 flex-1">{renderInlineFormatted(item)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.kind === "table") {
          return (
            <div key={idx} className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b bg-muted/50 text-[11px] font-medium text-muted-foreground">
                  <tr>
                    {block.headers.map((h, hIdx) => (
                      <th key={hIdx} className="px-3 py-2 font-medium">
                        {renderInlineFormatted(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 bg-background/50">
                  {block.rows.map((r, rIdx) => (
                    <tr key={rIdx}>
                      {r.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-foreground/90">
                          {renderInlineFormatted(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.kind === "code") {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] text-foreground"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.kind === "alert") {
          return (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-foreground"
            >
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{renderInlineFormatted(block.text)}</span>
            </div>
          );
        }

        return (
          <p key={idx} className="text-foreground/90">
            {renderInlineFormatted(block.text)}
          </p>
        );
      })}

      {usedFallback && modelUsed && (
        <p className="border-t pt-2 text-[11px] text-muted-foreground">
          Routed via fallback worker model ({modelUsed})
        </p>
      )}
    </div>
  );
}
