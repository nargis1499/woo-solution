import { beforeEach, it, expect, vi } from "vitest";
import { POST } from "@/app/api/nemesis/ai/agent/route";
import * as tools from "@/lib/ai/tools";
import * as settings from "@/lib/ai/settings";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai/providers";
import { assertAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "./tool-fixtures";
const realExecute = tools.executeAgentToolCall;
const topCall = {
  id: "preserved-provider-call",
  name: "get_top_customers",
  arguments: { sort: "spending", limit: 1 },
};
const store = {
  storeName: "Fixture store",
  currency: "USD",
  manageStock: true,
  categories: [],
};
beforeEach(() => {
  vi.mocked(assertAdmin).mockResolvedValue({
    id: uuid,
    name: "Admin fixture",
    email: null,
    avatarUrl: null,
  });
  const config = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    fallback_model: null,
    require_confirmation: true,
    api_keys: { groq: "fake-only-test-key" },
  };
  vi.spyOn(settings, "loadAiSettingsForAction").mockResolvedValue({
    server: config,
    client: settings.toPublicAiSettings(config),
    migrated: true,
  });
  vi.spyOn(tools, "loadStoreContextSummary").mockResolvedValue({
    context: store,
    money: { currency: "USD", rate: 1 },
  });
});
function request(body: Record<string, unknown>) {
  return new Request("https://fixture.invalid/api/nemesis/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
it.each(["who is the valuable customer?", "who is the top valuable customer"])(
  "real cloud route recovers %s without manually retrying the user prompt",
  async (prompt) => {
    const dispatch = vi
      .spyOn(tools, "executeAgentToolCall")
      .mockImplementation(async (opts) => {
        expect(opts.call.name).toBe("get_top_customers");
        return {
          toolOutputJson: JSON.stringify({ fixture: true }),
          badge: {
            id: opts.call.id,
            name: opts.call.name,
            summary: "Fixture customer read",
          },
        };
      });
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (bodies.length === 1)
          return Response.json(
            {
              error: {
                message:
                  "Tool call validation failed: attempted to call tool 'get_top_customers' which was not in request.tools",
              },
            },
            { status: 400 },
          );
        const message =
          bodies.length === 2
            ? {
                tool_calls: [
                  {
                    id: topCall.id,
                    function: {
                      name: topCall.name,
                      arguments: JSON.stringify(topCall.arguments),
                    },
                  },
                ],
              }
            : { content: "Fixture read completed." };
        return Response.json({
          choices: [{ message }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }),
    );
    const res = await POST(request({ phase: "run", prompt }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].call).toMatchObject(topCall);
    expect(bodies).toHaveLength(3);
    for (const body of bodies.slice(1))
      expect(JSON.stringify(body.tools)).toContain(
        '"name":"get_top_customers"',
      );
    expect(JSON.stringify(bodies[1].messages)).toContain(
      "Customers: purchases/spending",
    );
    expect(json.data.usage.requests).toBe(3);
    expect(json.data.usage.totalTokens).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  },
);
it("browser execution defers an unloaded call, keeps its ID/name, then accepts a schema-loaded retry", async () => {
  const first = await POST(
    request({
      phase: "ollama_execute_tools",
      catalogGroups: [],
      loadedToolNames: ["load_tool_groups"],
      toolCalls: [topCall],
    }),
  );
  const loaded = await first.json();
  expect(loaded.ok).toBe(true);
  expect(loaded.schemaOnly).toBe(true);
  expect(loaded.plans).toEqual([]);
  expect(loaded.widgets).toEqual([]);
  expect(loaded.toolResults[0]).toMatchObject({
    toolCallId: topCall.id,
    name: topCall.name,
  });
  expect(
    loaded.availableTools.some(
      (t: { name: string }) => t.name === topCall.name,
    ),
  ).toBe(true);
  const dispatch = vi
    .spyOn(tools, "executeAgentToolCall")
    .mockResolvedValue({
      toolOutputJson: '{"fixture":true}',
      badge: { id: "next", name: topCall.name, summary: "Fixture read" },
    });
  const second = await POST(
    request({
      phase: "ollama_execute_tools",
      catalogGroups: loaded.catalogGroups,
      loadedToolNames: loaded.availableTools.map(
        (t: { name: string }) => t.name,
      ),
      toolCalls: [{ ...topCall, id: "retry-id" }],
    }),
  );
  expect((await second.json()).schemaOnly).toBe(false);
  expect(dispatch.mock.calls[0][0].call.name).toBe(topCall.name);
  expect(createClient).not.toHaveBeenCalled();
});
it("loader + unloaded write preview in one batch never executes the write preview", async () => {
  const dispatch = vi
    .spyOn(tools, "executeAgentToolCall")
    .mockImplementation((opts) => realExecute(opts));
  const res = await POST(
    request({
      phase: "ollama_execute_tools",
      loadedToolNames: ["load_tool_groups"],
      toolCalls: [
        {
          id: "loader",
          name: "load_tool_groups",
          arguments: { toolNames: ["preview_order_operations"] },
        },
        {
          id: "unloaded-write",
          name: "preview_order_operations",
          arguments: {
            orders: [uuid],
            action: "note",
            text: "Do not execute this during schema loading",
          },
        },
      ],
    }),
  );
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.schemaOnly).toBe(true);
  expect(json.plans).toEqual([]);
  expect(dispatch.mock.calls.map(([opts]) => opts.call.name)).toEqual([
    "load_tool_groups",
    "load_tool_groups",
  ]);
  expect(createClient).not.toHaveBeenCalled();
});
it("browser catalog state rejects invented tool names", async () => {
  const res = await POST(
    request({
      phase: "ollama_execute_tools",
      loadedToolNames: ["invented_tool"],
      toolCalls: [topCall],
    }),
  );
  expect(res.status).toBe(400);
  expect(createClient).not.toHaveBeenCalled();
});
