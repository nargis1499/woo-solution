import type { AiResponsePolicy } from "./response-budget";

type JsonObject = Record<string, unknown>;
/** Explicit model-only projections, not a generic truncator. Full UI/approval data,
 * exact tool arguments, selected IDs, errors and source copy are never shortened.
 * Unknown/future result contracts pass through until an explicit projection is added.
 */
export function compactToolResult(
  name: string,
  json: string,
  policy: AiResponsePolicy,
): string {
  let data: JsonObject;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return json;
    data = { ...parsed };
  } catch {
    return json;
  }
  if (data.error) return json;
  if (
    typeof data.instruction === "string" &&
    data.instruction.startsWith(policy.summaryInstruction)
  ) {
    data.instruction = data.instruction
      .slice(policy.summaryInstruction.length)
      .trim();
    if (!data.instruction) delete data.instruction;
  }
  const sample = (value: unknown) =>
    Array.isArray(value) ? value.slice(0, policy.modelSampleRows) : value;
  if (name === "query_inventory" && Array.isArray(data.items)) {
    data.loadedCount = data.shownCount;
    data.items = sample(data.items);
    data.shownCount = (data.items as unknown[]).length;
    data.sampleOnly = true;
  }
  if (name === "get_store_analytics") {
    data.topProducts = sample(data.topProducts);
    data.pendingOrders = sample(data.pendingOrders);
    data.sampleOnly = true;
  }
  if (name === "preview_category_discount") {
    // Stock badges remain in the approval card. A discount is not a stock action.
    delete data.lowStockInSelection;
    data.sample = Array.isArray(data.sample)
      ? sample(
          data.sample.map((item: JsonObject) => ({
            name: item.name,
            from: item.from,
            to: item.to,
          })),
        )
      : data.sample;
    data.sampleOnly = true;
  }
  if (name === "preview_product_status_update") {
    data.items = sample(data.items);
    data.sampleOnly = true;
  }
  if (name === "audit_and_fix_seo" && Array.isArray(data.fixes)) {
    data.fixes = data.fixes
      .slice(0, policy.modelSampleRows)
      .map((fix: JsonObject) => ({ target: fix.target, field: fix.field }));
    data.note =
      "Full proposed replacements are in the approval card, not saved. Examples are sampled; use the full preparedFixesCount.";
  }
  return JSON.stringify(data);
}

/** Keep one copy of identical per-tool instructions within a turn. Only the
 * instruction prose is deduplicated; all data, statuses, warnings and IDs remain.
 * The original instruction stays in an earlier, retained protocol message.
 */
export function deduplicateToolInstructions(
  name: string,
  json: string,
  seen: Set<string>,
): string {
  try {
    const value = JSON.parse(json);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.instruction !== "string" ||
      value.error
    )
      return json;
    const key = `${name}\u0000${value.instruction}`;
    if (!seen.has(key)) {
      seen.add(key);
      return json;
    }
    delete value.instruction;
    return JSON.stringify(value);
  } catch {
    return json;
  }
}
