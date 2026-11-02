import type { AiToolCall, AiToolSpec } from "./client";
import type { AgentGroup } from "./request-context";

/** Small universal directory; real schemas are loaded only for requested capabilities. */
export const TOOL_GROUP_DIRECTORY = {
  inventory_intelligence:
    "stock forecasts, dead/overstock, spikes, reorder advice, signal-based publication previews",
  inventory_operations: "product/variation filters, numeric stock/price comparisons, full counts/pages; stock/status/featured previews",
  store_analytics: "store/catalog snapshot; exact paid metrics use orders",
  pricing: "category/product discount previews",
  content_seo:
    "read/rewrite product/page/post/media copy; SEO audit/fix previews",
  customers:
    "customer search/details/history, top/new/repeat/inactive buyers and metrics",
  orders:
    "order search/details, paid analytics, problems and approved order-operation previews",
} satisfies Record<AgentGroup, string>;
export const LOAD_TOOL_GROUPS = "load_tool_groups";
export const TOOL_DISCOVERY: AiToolSpec = {
  name: LOAD_TOOL_GROUPS,
  description: `Only tools in request.tools are callable NOW. Directory names are NOT loaded tools. First call load_tool_groups with exact toolNames (or groups); wait for its result before calling them. Schemas persist this turn. Include dependencies for mixed tasks. Loading is metadata only, not task execution. ${Object.entries(
    TOOL_GROUP_DIRECTORY,
  )
    .map(([key, summary]) => `${key}: ${summary}`)
    .join("; ")}.`,
  parameters: {
    type: "object",
    properties: {
      groups: {
        type: ["array", "null"],
        items: { type: "string", enum: Object.keys(TOOL_GROUP_DIRECTORY) },
        maxItems: Object.keys(TOOL_GROUP_DIRECTORY).length,
      },
      toolNames: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "Prefer exact names from directory; load only these schemas. Empty/null means use groups.",
      },
    },
  },
};
/** Scoped/expanded turns already know their domain; do not resend the directory. */
export const TOOL_DISCOVERY_BRIEF: AiToolSpec = {
  ...TOOL_DISCOVERY,
  description:
    "Only currently supplied tool schemas are callable. First load missing toolNames/groups with load_tool_groups, wait for the result, then call them. Metadata only; schemas persist this turn.",
};
/** Name-only directory is much smaller than every parameter schema. The registry,
 * not model guesses, remains the allow-list used by the executor.
 */
export function discoveryForTools(tools: AiToolSpec[]): AiToolSpec {
  return {
    ...TOOL_DISCOVERY,
    description: `${TOOL_DISCOVERY.description} Prefer exact toolNames from this directory: ${tools.map((tool) => tool.name).join(", ")}. Additional dependencies can be loaded by group.`,
  };
}
export function catalogGroups(value: unknown): AgentGroup[] {
  if (
    !Array.isArray(value) ||
    value.length > Object.keys(TOOL_GROUP_DIRECTORY).length ||
    value.some(
      (g) => typeof g !== "string" || !Object.hasOwn(TOOL_GROUP_DIRECTORY, g),
    )
  )
    throw new Error("Choose supported capability groups.");
  return [...new Set(value)] as AgentGroup[];
}
export function mergeToolCatalog(
  current: AiToolSpec[],
  additions: AiToolSpec[],
): AiToolSpec[] {
  return [
    ...new Map(
      [...current, ...additions].map((tool) => [tool.name, tool]),
    ).values(),
  ];
}
export function discoveryOnly(calls: AiToolCall[]): boolean {
  return (
    calls.length > 0 && calls.every((call) => call.name === LOAD_TOOL_GROUPS)
  );
}
