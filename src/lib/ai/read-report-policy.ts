import type { AiToolCall } from "./client";
import type { AiUiWidget } from "./types";
import {
  isStandaloneInventoryReport,
  isStandaloneOrderReport,
} from "./response-budget";

export type ReadReportIntent = { tool: string; kind: string; mode?: string };

/** Whole-message, conservative read grammar, not keyword-only routing. Unsupported
 * modifiers, identities, comparisons, explanations, follow-ups and mixed actions
 * retain the full agent. No extra model call is spent on classification.
 */
export function readReportIntent(prompt: string): ReadReportIntent | null {
  if (isStandaloneInventoryReport(prompt))
    return {
      tool: "analyze_inventory_intelligence",
      kind: "inventory_intelligence",
    };
  if (isStandaloneOrderReport(prompt))
    return {
      tool: "query_order_intelligence",
      kind: "order_intelligence",
      mode: "report",
    };
  const text = prompt
    .toLowerCase()
    .trim()
    .replace(/completed\s+and\s+paid/g, "completed paid")
    .replace(/[.!?,]/g, " ")
    .replace(/\s+/g, " ");
  if (!/\b(customers?|buyers?)\b/.test(text)) return null;
  const allowed = new Set(
    "please show list find get give me us the a an my our store stores customer customers buyer buyers top most valuable highest high value spending spend spent best new newly converted first time repeat returning multiple inactive inactivity recent recently analytics intelligence metrics performance report reports all history lifetime by with at least more than over under minimum maximum completed paid purchases purchase orders order total in for from to last past previous days day weeks week months month years year today yesterday this month week year of and run analyze analyse  one two three four five ten twenty fifty ninety january february march april may june july august september october november december".split(
      /\s+/,
    ),
  );
  // A bare conjunction can hide another task. Only completed AND paid is normalized above.
  if (/\b(and|or|then)\b/.test(text)) return null;
  const words = text.split(" ").filter(Boolean);
  if (
    !words.every(
      (word) =>
        allowed.has(word) ||
        /^\d+$/.test(word) ||
        /^\d{4}-\d{2}-\d{2}$/.test(word),
    )
  )
    return null;
  const candidates = [
    /\b(top|valuable|highest|high value|best)\b/.test(text) ? "top" : null,
    /\b(new|newly converted|first time)\b/.test(text) ? "new" : null,
    /\b(repeat|returning|multiple)\b/.test(text) ? "repeat" : null,
    /\b(inactive|inactivity)\b/.test(text) ? "inactive" : null,
    /\b(analytics|intelligence|metrics|performance)\b/.test(text)
      ? "analytics"
      : null,
  ].filter(Boolean);
  if (candidates.length !== 1) return null;
  const mode = candidates[0]!;
  // Maximum purchase-count filters are not supported by these report tools.
  if (/\b(maximum|under)\b/.test(text)) return null;
  // Returning buyers are not necessarily repeat buyers within the requested window.
  if (/\breturning\b/.test(text)) return null;
  if (
    mode !== "repeat" &&
    /\b(with|minimum|maximum|at least|more than|over|under)\b/.test(text)
  )
    return null;
  const tools: Record<string, string> = {
    top: "get_top_customers",
    new: "get_new_customers",
    repeat: "get_repeat_customers",
    inactive: "get_inactive_customers",
    analytics: "get_customer_analytics",
  };
  const tool = tools[mode];
  return tool ? { tool, kind: "customer_intelligence", mode } : null;
}

/** Only a successful, single, matching read with a server-built summary can finish.
 * The caller must also preserve history, custom instructions and language settings.
 */
export function completedReadReport(
  intent: ReadReportIntent | null,
  calls: AiToolCall[],
  widgets: AiUiWidget[],
  hasPlans: boolean,
  summaries: string[],
): boolean {
  if (
    !intent ||
    hasPlans ||
    calls.length !== 1 ||
    calls[0].name !== intent.tool ||
    summaries.length !== 1 ||
    !summaries[0]
  )
    return false;
  return widgets.some(
    (widget) =>
      widget.kind === intent.kind &&
      (!intent.mode || ("mode" in widget && widget.mode === intent.mode)),
  );
}

/** Do not bypass requested languages with an English template. */
export function supportsReportSummary(language: string): boolean {
  return /^(?:english|en(?:[-_][a-z0-9]+)*)$/i.test(language.trim());
}
