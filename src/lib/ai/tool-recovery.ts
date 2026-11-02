import type { AiToolCall, AiToolSpec } from "./client";
import { LOAD_TOOL_GROUPS, mergeToolCatalog } from "./tool-catalog";

/** Only a provider HTTP rejection of a named, absent tool permits expansion.
 * Never parse/execute failed_generation or infer names from user/tool content.
 */
export function missingProviderTool(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; message?: unknown };
  if (e.status !== 400 && e.status !== 422) return null;
  const text = typeof e.message === "string" ? e.message : "";
  return (
    /(?:attempted to call tool|tool)\s+['"`]([a-zA-Z0-9_-]{1,64})['"`]\s+(?:which\s+was|is|was)\s+not\s+in\s+request\.tools\b/i.exec(
      text,
    )?.[1] ?? null
  );
}

/** A rejected generation has not executed anything. Load its exact registered
 * schema and regenerate against the original messages, at most twice. */
export async function withToolSchemaRecovery<T>(opts: {
  tools: AiToolSpec[];
  registry: AiToolSpec[];
  run: (tools: AiToolSpec[]) => Promise<T>;
  onLoad?: (
    additions: AiToolSpec[],
    tools: AiToolSpec[],
  ) => Promise<void> | void;
}): Promise<{ result: T; tools: AiToolSpec[]; unreportedRequests: number }> {
  let tools = opts.tools;
  const discoveryEnabled = tools.some((t) => t.name === LOAD_TOOL_GROUPS);
  let retries = 0;
  for (;;) {
    try {
      return {
        result: await opts.run(tools),
        tools,
        unreportedRequests: retries,
      };
    } catch (error) {
      const name = missingProviderTool(error);
      const tool = opts.registry.find((t) => t.name === name);
      if (
        !discoveryEnabled ||
        retries >= 2 ||
        !tool ||
        tools.some((t) => t.name === name)
      )
        throw error;
      tools = mergeToolCatalog(tools, [tool]);
      await opts.onLoad?.([tool], tools);
      retries++;
    }
  }
}

/** Native/prompt models can also return an unloaded tool without HTTP rejection.
 * Respond with schema metadata, NOT a business result; regenerate before executing.
 * Preserve the original assistant call and its ID in protocol history. */
export function schemaFirstCall(
  call: AiToolCall,
  tools: AiToolSpec[],
  registry: AiToolSpec[],
): AiToolCall {
  if (
    call.name === LOAD_TOOL_GROUPS ||
    tools.some((t) => t.name === call.name) ||
    !registry.some((t) => t.name === call.name)
  )
    return call;
  return {
    id: call.id,
    name: LOAD_TOOL_GROUPS,
    arguments: { toolNames: [call.name] },
  };
}
