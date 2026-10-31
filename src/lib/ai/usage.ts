import type { AiCompletionResult } from "./client";
import type { AiTurnUsage } from "./types";

/** Only successful provider responses with reported counters are counted as known.
 * Failed HTTP attempts may consume quota without returning measurable usage.
 */
export function createUsageCollector() {
  let input = 0;
  let output = 0;
  let total = 0;
  let requests = 0;
  let complete = true;
  const models = new Map<string, number>();
  return {
    record(result: Pick<AiCompletionResult, "modelUsed" | "usage">) {
      requests++;
      models.set(result.modelUsed, (models.get(result.modelUsed) ?? 0) + 1);
      complete = complete && result.usage.reported === true && [result.usage.promptTokens, result.usage.completionTokens, result.usage.totalTokens].every(n => Number.isFinite(n) && n >= 0);
      input += result.usage.promptTokens;
      output += result.usage.completionTokens;
      total += result.usage.totalTokens;
    },
    snapshot(context: Pick<AiTurnUsage, "contextMode" | "toolCount" | "historyMessages">): AiTurnUsage {
      return {
        ...context, inputTokens: complete ? input : null, outputTokens: complete ? output : null,
        totalTokens: complete ? total : null, requests,
        models: [...models].map(([model, count]) => ({ model, requests: count })),
      };
    },
  };
}
