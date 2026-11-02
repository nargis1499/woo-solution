import { describe, it, expect, vi } from "vitest";
import Ajv from "ajv";
import {
  AGENT_TOOLS,
  AGENT_TOOL_GROUPS,
  executeAgentToolCall,
  selectAgentTools,
} from "@/lib/ai/tools";
import {
  TOOL_DISCOVERY,
  discoveryForTools,
  mergeToolCatalog,
  catalogGroups,
} from "@/lib/ai/tool-catalog";
import {
  schemaFirstCall,
  withToolSchemaRecovery,
  missingProviderTool,
} from "@/lib/ai/tool-recovery";
import { runModelCompletion, type AiToolSpec } from "@/lib/ai/client";
import {
  AI_PROVIDER_IDS,
  DEFAULT_AI_SETTINGS,
  type AiProviderId,
} from "@/lib/ai/providers";
import { responsePolicy } from "@/lib/ai/response-budget";
import { createUsageCollector } from "@/lib/ai/usage";
import { createClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/admin/auth";
import { uuid, argumentsByTool } from "./tool-fixtures";
const allTools = [...AGENT_TOOLS, TOOL_DISCOVERY];
const ajv = new Ajv({ strict: false, allowUnionTypes: true });
const rejected = (name: string, status = 400) =>
  Object.assign(
    new Error(
      `Tool call validation failed: attempted to call tool '${name}' which was not in request.tools`,
    ),
    { status },
  );
const policy = responsePolicy(DEFAULT_AI_SETTINGS);

function wireTools(
  body: Record<string, unknown>,
  provider: AiProviderId,
): AiToolSpec[] {
  if (provider === "anthropic")
    return (
      body.tools as Array<{
        name: string;
        description: string;
        input_schema: AiToolSpec["parameters"];
      }>
    ).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));
  if (provider === "gemini")
    return (
      body.tools as Array<{
        functionDeclarations: Array<{
          name: string;
          description: string;
          parametersJsonSchema: AiToolSpec["parameters"];
        }>;
      }>
    )[0].functionDeclarations.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parametersJsonSchema,
    }));
  return (body.tools as Array<{ function: AiToolSpec }>).map((t) => t.function);
}
function success(provider: AiProviderId, tool: AiToolSpec) {
  const args = argumentsByTool[tool.name];
  if (provider === "anthropic")
    return {
      model: "fixture-model",
      content: [
        { type: "tool_use", id: "native-id", name: tool.name, input: args },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  if (provider === "gemini")
    return {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: tool.name, args },
                thoughtSignature: "keep-signature",
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };
  return {
    model: "fixture-model",
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "native-id",
              function: { name: tool.name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}
async function completion(
  provider: AiProviderId,
  tool: AiToolSpec,
  initial: AiToolSpec[],
  rejectFirst = false,
) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (rejectFirst && requests.length === 1)
        return Response.json(
          {
            error: {
              message: rejected(tool.name).message,
              failed_generation: '{"DO_NOT_EXECUTE":"untrusted"}',
            },
          },
          { status: 400 },
        );
      return Response.json(success(provider, tool));
    }),
  );
  const onLoad = vi.fn(async () => "Refreshed capability instructions");
  const result = await runModelCompletion({
    settings: {
      ...DEFAULT_AI_SETTINGS,
      provider,
      primary_model: "fixture-model",
      fallback_model: null,
      api_keys: { [provider]: "fake-test-key" },
    },
    systemPrompt: "Isolated schema test",
    messages: [
      { role: "user", content: "Read or preview only; never apply changes." },
    ],
    tools: initial,
    toolRegistry: AGENT_TOOLS,
    onToolsLoaded: onLoad,
  });
  return { result, requests, onLoad };
}

describe("Every registered tool: contract, discovery, deferred dispatch and authorization", () => {
  it("has unique registrations and an explicit fixture for every tool", () => {
    expect(new Set(allTools.map((t) => t.name)).size).toBe(allTools.length);
    expect(Object.keys(argumentsByTool).sort()).toEqual(
      allTools.map((t) => t.name).sort(),
    );
    expect(catalogGroups(AGENT_TOOL_GROUPS.map((g) => g.id))).toHaveLength(
      AGENT_TOOL_GROUPS.length,
    );
  });
  for (const tool of allTools) {
    it(`${tool.name}: serializable JSON schema accepts its representative arguments`, () => {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.description.length).toBeGreaterThan(0);
      const validate = ajv.compile(JSON.parse(JSON.stringify(tool.parameters)));
      expect(
        validate(argumentsByTool[tool.name]),
        JSON.stringify(validate.errors),
      ).toBe(true);
      if (tool.parameters.required?.length) {
        const args = { ...argumentsByTool[tool.name] };
        delete args[tool.parameters.required[0]];
        expect(validate(args)).toBe(false);
      }
    });
    it(`${tool.name}: denied before database access for a non-admin`, async () => {
      await expect(
        executeAgentToolCall({
          call: {
            id: "auth",
            name: tool.name,
            arguments: argumentsByTool[tool.name],
          },
          aiSettings: DEFAULT_AI_SETTINGS,
          allowModelSubcall: false,
          store: {
            storeName: "Fixture",
            currency: "USD",
            manageStock: true,
            categories: [],
          },
          money: { currency: "USD", rate: 1 },
        }),
      ).rejects.toThrow("Administrator access required");
      expect(createClient).not.toHaveBeenCalled();
    });
    if (tool.name === TOOL_DISCOVERY.name) continue;
    it(`${tool.name}: exact schema is discoverable and unloaded native/prompt calls only load metadata`, async () => {
      const initial = [discoveryForTools(AGENT_TOOLS)];
      expect(initial[0].description).toContain(tool.name);
      const call = {
        id: "keep-original-id",
        name: tool.name,
        arguments: argumentsByTool[tool.name],
      };
      const original = structuredClone(call);
      const dispatch = schemaFirstCall(call, initial, AGENT_TOOLS);
      expect(dispatch).toEqual({
        id: call.id,
        name: TOOL_DISCOVERY.name,
        arguments: { toolNames: [tool.name] },
      });
      vi.mocked(assertAdmin).mockResolvedValueOnce({
        id: uuid,
        email: null,
        name: "Test admin",
        avatarUrl: null,
      });
      const loaded = await executeAgentToolCall({
        call: dispatch,
        aiSettings: DEFAULT_AI_SETTINGS,
        allowModelSubcall: false,
        store: {
          storeName: "Fixture",
          currency: "USD",
          manageStock: true,
          categories: [],
        },
        money: { currency: "USD", rate: 1 },
      });
      expect(loaded.availableTools?.find((t) => t.name === tool.name)).toEqual(
        tool,
      );
      expect(loaded.plan).toBeUndefined();
      expect(loaded.widget).toBeUndefined();
      expect(createClient).not.toHaveBeenCalled();
      expect(
        schemaFirstCall(
          call,
          mergeToolCatalog(initial, loaded.availableTools!),
          AGENT_TOOLS,
        ),
      ).toBe(call);
      expect(call).toEqual(original);
      // Original request snapshot cannot execute a sibling call merely because another loaded its schema.
      expect(schemaFirstCall(call, initial, AGENT_TOOLS).name).toBe(
        TOOL_DISCOVERY.name,
      );
    });
  }
});

for (const provider of AI_PROVIDER_IDS) {
  describe(`${provider}: every tool through the real wire adapter (mock HTTP only)`, () => {
    for (const tool of allTools) {
      it(`${tool.name}: declared schema and exact returned call survive serialization`, async () => {
        const { result, requests, onLoad } = await completion(provider, tool, [
          tool,
        ]);
        expect(wireTools(requests[0], provider)).toEqual([tool]);
        expect(result.toolCalls[0]).toMatchObject({
          name: tool.name,
          arguments: argumentsByTool[tool.name],
        });
        if (provider === "gemini")
          expect(result.toolCalls[0].thoughtSignature).toBe("keep-signature");
        else expect(result.toolCalls[0].id).toBe("native-id");
        expect(onLoad).not.toHaveBeenCalled();
        expect(requests).toHaveLength(1);
      });
      if (tool.name === TOOL_DISCOVERY.name) continue;
      it(`${tool.name}: missing request.tools rejection loads exactly its registered schema and retries`, async () => {
        const initial = [discoveryForTools(AGENT_TOOLS)];
        const { result, requests, onLoad } = await completion(
          provider,
          tool,
          initial,
          true,
        );
        expect(requests).toHaveLength(2);
        expect(onLoad).toHaveBeenCalledOnce();
        expect(wireTools(requests[0], provider)).toEqual(initial);
        expect(wireTools(requests[1], provider)).toEqual([...initial, tool]);
        expect(result.toolCalls[0]).toMatchObject({
          name: tool.name,
          arguments: argumentsByTool[tool.name],
        });
        expect(result.unreportedRequests).toBe(1);
        expect(requests[1]).not.toHaveProperty("failed_generation");
        expect(createClient).not.toHaveBeenCalled();
      });
    }
  });
}

describe("Bounded recovery and original regression", () => {
  const tools = AGENT_TOOLS.slice(0, 3),
    initial = [TOOL_DISCOVERY];
  it("recognizes the screenshot's exact failure without sentence matching", () =>
    expect(missingProviderTool(rejected("get_top_customers"))).toBe(
      "get_top_customers",
    ));
  it.each([
    "who is the valuable customer?",
    "who is the top valuable customer",
    "Bring me products where stock is greater than 20",
  ])("%s retains discovery or a directly loaded capability", (prompt) => {
    expect(
      selectAgentTools(prompt, policy).some(
        (t) =>
          t.name === TOOL_DISCOVERY.name ||
          t.name === "get_top_customers" ||
          t.name === "query_inventory",
      ),
    ).toBe(true);
  });
  it.each([401, 403, 429, 500, 503])(
    "does not retry HTTP %s as schema discovery",
    async (status) => {
      const error = rejected(tools[0].name, status),
        run = vi.fn(async () => {
          throw error;
        });
      await expect(
        withToolSchemaRecovery({ tools: initial, registry: AGENT_TOOLS, run }),
      ).rejects.toBe(error);
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it.each(["delete_all_products", "constructor", "__proto__"])(
    "never loads unknown tool %s",
    async (name) => {
      const error = rejected(name),
        run = vi.fn(async () => {
          throw error;
        });
      await expect(
        withToolSchemaRecovery({ tools: initial, registry: AGENT_TOOLS, run }),
      ).rejects.toBe(error);
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it("does not retry schema argument errors or malformed failed_generation", async () => {
    for (const message of [
      "Tool call validation failed: invalid arguments for query_inventory",
      "unknown parameter stock",
      '{"failed_generation":"get_top_customers"}',
    ]) {
      const error = Object.assign(new Error(message), { status: 400 });
      expect(missingProviderTool(error)).toBeNull();
    }
  });
  it("does not reopen tool-free finalization or already-loaded schemas", async () => {
    for (const supplied of [
      [],
      [tools[0]],
      mergeToolCatalog(initial, [tools[0]]),
    ]) {
      const error = rejected(tools[0].name),
        run = vi.fn(async () => {
          throw error;
        });
      await expect(
        withToolSchemaRecovery({ tools: supplied, registry: AGENT_TOOLS, run }),
      ).rejects.toBe(error);
      expect(run).toHaveBeenCalledOnce();
    }
  });
  it("bounds repeated distinct missing-schema rejections at two retries", async () => {
    let attempts = 0;
    const onLoad = vi.fn();
    await expect(
      withToolSchemaRecovery({
        tools: initial,
        registry: AGENT_TOOLS,
        onLoad,
        run: async () => {
          throw rejected(tools[attempts++].name);
        },
      }),
    ).rejects.toThrow(tools[2].name);
    expect(attempts).toBe(3);
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
  it("accounts for failed recovery requests without inventing token totals", () => {
    const usage = createUsageCollector();
    usage.record({
      modelUsed: "fixture",
      unreportedRequests: 1,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        reported: true,
      },
    });
    expect(
      usage.snapshot({ contextMode: "full", toolCount: 1, historyMessages: 0 }),
    ).toMatchObject({
      requests: 2,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
    });
  });
});

describe("Reasoning-option retries and fallback accounting", () => {
  const top = AGENT_TOOLS.find((t) => t.name === "get_top_customers")!;
  const config = {
    ...DEFAULT_AI_SETTINGS,
    primary_model: "openai/gpt-oss-120b",
    fallback_model: null,
    api_keys: { groq: "fake-key" },
  };
  it("reasoning models recover the screenshot error without a redundant reasoning-option retry", async () => {
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++requests === 1
          ? Response.json(
              { error: { message: rejected(top.name).message } },
              { status: 400 },
            )
          : Response.json(success("groq", top)),
      ),
    );
    const result = await runModelCompletion({
      settings: config,
      systemPrompt: "Fixture",
      messages: [],
      tools: [TOOL_DISCOVERY],
      toolRegistry: AGENT_TOOLS,
    });
    expect(requests).toBe(2);
    expect(result.unreportedRequests).toBe(1);
  });
  it("actual unsupported reasoning_effort still retries without that option", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? Response.json(
              { error: { message: "Unknown field reasoning_effort" } },
              { status: 400 },
            )
          : Response.json(success("groq", TOOL_DISCOVERY));
      }),
    );
    const result = await runModelCompletion({
      settings: config,
      systemPrompt: "Fixture",
      messages: [],
      tools: [TOOL_DISCOVERY],
      toolRegistry: AGENT_TOOLS,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("reasoning_effort");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
    expect(result.unreportedRequests).toBe(1);
  });
  it("preserves loaded schemas and counts failed schema/overload requests across model fallback", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1)
          return Response.json(
            { error: { message: rejected(top.name).message } },
            { status: 400 },
          );
        if (bodies.length === 2)
          return Response.json(
            { error: { message: "Rate limit" } },
            { status: 429 },
          );
        return Response.json(success("groq", top));
      }),
    );
    const result = await runModelCompletion({
      settings: { ...config, fallback_model: "fallback-model" },
      systemPrompt: "Fixture",
      messages: [],
      tools: [TOOL_DISCOVERY],
      toolRegistry: AGENT_TOOLS,
    });
    expect(bodies).toHaveLength(3);
    expect(result.usedFallback).toBe(true);
    expect(result.unreportedRequests).toBe(2);
    expect(wireTools(bodies[2], "groq").some((t) => t.name === top.name)).toBe(
      true,
    );
    expect(bodies[2].model).toBe("fallback-model");
  });
});
