import type { AiSettingsServer } from "@/lib/ai/providers";

export type AiRateBudget = {
  limitTokensPerMin?: number | null;
  remainingTokensPerMin?: number | null;
  /** Provider-defined request window (may be daily, not necessarily per-minute). */
  limitRequests?: number | null;
  remainingRequests?: number | null;
};
export type AiResponsePolicy = {
  mode: "compact" | "detailed";
  modelSampleRows: number;
  visibleRows: number;
  summaryInstruction: string;
};

/** Shared policy for all agent capabilities. Unknown quotas are NOT assumed to be unlimited
 * or free-tier. Economy is an explicit budget preference; other modes adapt to real headers.
 * Never shorten mutation arguments, approved copy, selected IDs or underlying calculations.
 */
export function responsePolicy(settings: Pick<AiSettingsServer, "token_budget_mode">, rate: AiRateBudget = {}): AiResponsePolicy {
  const positive = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0;
  const limitedTokens = positive(rate.limitTokensPerMin) && rate.limitTokensPerMin! <= 16000;
  const limitedRequests = positive(rate.limitRequests) && rate.limitRequests! <= 30;
  const lowTokens = rate.remainingTokensPerMin != null && rate.remainingTokensPerMin >= 0 &&
    (rate.remainingTokensPerMin < 2000 || (positive(rate.limitTokensPerMin) && rate.remainingTokensPerMin / rate.limitTokensPerMin! < 0.25));
  const lowRequests = rate.remainingRequests != null && rate.remainingRequests >= 0 &&
    (rate.remainingRequests <= 2 || (positive(rate.limitRequests) && rate.remainingRequests / rate.limitRequests! < 0.2));
  const compact = settings.token_budget_mode === "economy" || limitedTokens || limitedRequests || lowTokens || lowRequests;
  return {
    mode: compact ? "compact" : "detailed",
    modelSampleRows: compact ? 3 : 12,
    visibleRows: compact ? 5 : 20,
    summaryInstruction: compact
      ? "Budget-constrained response: give at most 2 short sentences (about 60 words). Report the main finding and next step only. The UI already displays product cards. Do not repeat products, calculations, assumptions sections or tables. Preserve critical missing-data warnings."
      : "No constrained budget detected: provide fuller explanations when useful or explicitly requested, but do not duplicate dashboard rows. Keep routine dashboard summaries brief. Use plain-language calculations, not long formula dumps.",
  };
}

/** Conservative allowlist: unknown/custom wording keeps the full agent workflow.
 * A keyword match alone can silently drop mixed analytics, content, or write tasks.
 */
export function isStandaloneInventoryReport(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replace(/[.,;:!?]/g, " ").replace(/\s+/g, " ").trim();
  const starter = "analyze inventory intelligence predict stock depletion identify dead and overstocked products detect sales spikes and suggest reorder quantities show the assumptions do not change anything";
  if (normalized === starter) return true;
  return /^(?:please )?(?:(?:analyze|run|show) )?(?:inventory intelligence(?: report)?|stock depletion|dead (?:stock|inventory)|overstock|sales spikes?|reorder (?:quantities|recommendations))$/.test(normalized);
}

/** Only the known read-only order starter gets a narrowed catalog/fast finish. */
export function isStandaloneOrderReport(prompt: string): boolean {
  return /^(?:analyze|show|run) order intelligence(?: report)?[.!?]?$/i.test(prompt.trim());
}
