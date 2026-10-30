import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type {
  AiActionPlan,
  AiAgentTurnResponse,
  AiChatHistoryItem,
  AiToolBadge,
} from "@/lib/ai/types";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

export function formatOllamaCorsError(baseUrl: string, err: unknown): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-site.com";
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
    return `Could not reach Ollama at ${baseUrl} from your browser. Make sure Ollama is running on this computer with CORS enabled: OLLAMA_ORIGINS="${origin}" ollama serve`;
  }
  return msg;
}

export async function listBrowserOllamaModels(baseUrl: string): Promise<string[]> {
  const root = trimSlash(baseUrl || "http://localhost:11434").replace(/\/v1$/, "");
  try {
    const res = await fetch(`${root}/api/tags`);
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
  } catch (err) {
    throw new Error(formatOllamaCorsError(root, err));
  }
}

export async function testBrowserOllamaConnection(opts: {
  baseUrl: string;
  model: string;
  numCtx: number;
  disableThinking: boolean;
}): Promise<{ latencyMs: number; modelUsed: string; toolCallingVerified: boolean }> {
  const root = trimSlash(opts.baseUrl || "http://localhost:11434").replace(/\/v1$/, "");
  const started = Date.now();
  try {
    const res = await fetch(`${root}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        think: !opts.disableThinking,
        options: { num_ctx: opts.numCtx || 16384, temperature: 0.1 },
        messages: [
          {
            role: "system",
            content: "Call verify_agent_ready or reply Ready.",
          },
          {
            role: "user",
            content: "Ping check.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "verify_agent_ready",
              description: "Confirms local Ollama tool-calling works.",
              parameters: {
                type: "object",
                properties: { ok: { type: "boolean" } },
              },
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt.slice(0, 240) || `Ollama HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      model?: string;
      message?: { tool_calls?: unknown[]; content?: string };
    };
    return {
      latencyMs: Date.now() - started,
      modelUsed: json.model || opts.model,
      toolCallingVerified: Array.isArray(json.message?.tool_calls) && json.message.tool_calls.length > 0,
    };
  } catch (err) {
    throw new Error(formatOllamaCorsError(root, err));
  }
}

export async function runBrowserOllamaAgentTurn(opts: {
  prompt: string;
  history: AiChatHistoryItem[];
}): Promise<AiAgentTurnResponse> {
  const prepRes = await fetch("/api/nemesis/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase: "ollama_prepare" }),
  });
  const prepJson = (await prepRes.json()) as {
    ok: boolean;
    error?: string;
    systemPrompt: string;
    tools: AiToolSpec[];
    ollamaBaseUrl: string;
    model: string;
    numCtx: number;
    disableThinking: boolean;
  };
  if (!prepJson.ok) {
    throw new Error(prepJson.error || "Failed to initialize local Ollama session.");
  }

  const root = trimSlash(prepJson.ollamaBaseUrl || "http://localhost:11434").replace(/\/v1$/, "");
  const ollamaTools = prepJson.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const wireMessages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        prepJson.disableThinking && /qwen3/i.test(prepJson.model)
          ? `${prepJson.systemPrompt}\n/no_think`
          : prepJson.systemPrompt,
    },
    ...opts.history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: opts.prompt },
  ];

  const toolBadges: AiToolBadge[] = [];
  const plans: AiActionPlan[] = [];
  let totalTokens = 0;
  let finalReply = "";

  for (let round = 0; round <= 3; round++) {
    let chatRes: Response;
    try {
      chatRes = await fetch(`${root}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prepJson.model,
          stream: false,
          think: !prepJson.disableThinking,
          options: { num_ctx: prepJson.numCtx || 16384, temperature: 0.2 },
          messages: wireMessages,
          ...(round < 3 ? { tools: ollamaTools } : {}),
        }),
      });
    } catch (err) {
      throw new Error(formatOllamaCorsError(root, err));
    }

    if (!chatRes.ok) {
      const txt = await chatRes.text();
      throw new Error(txt.slice(0, 260) || `Local Ollama error (${chatRes.status})`);
    }

    const chatJson = (await chatRes.json()) as {
      prompt_eval_count?: number;
      eval_count?: number;
      message?: {
        content?: string;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: unknown };
        }>;
      };
    };

    totalTokens += (chatJson.prompt_eval_count ?? 0) + (chatJson.eval_count ?? 0);
    const rawCalls = chatJson.message?.tool_calls ?? [];
    const content = (chatJson.message?.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    if (rawCalls.length === 0 || round === 3) {
      finalReply = content;
      break;
    }

    const parsedCalls: AiToolCall[] = rawCalls
      .filter((c) => Boolean(c.function?.name))
      .map((c, idx) => ({
        id: `ollama_tc_${round}_${idx}`,
        name: c.function!.name!,
        arguments: parseArgs(c.function?.arguments),
      }));

    wireMessages.push({
      role: "assistant",
      content: content || "",
      tool_calls: rawCalls,
    });

    const execRes = await fetch("/api/nemesis/ai/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase: "ollama_execute_tools",
        toolCalls: parsedCalls,
      }),
    });
    const execJson = (await execRes.json()) as {
      ok: boolean;
      error?: string;
      toolResults: Array<{ toolCallId: string; name: string; content: string }>;
      badges: AiToolBadge[];
      plans: AiActionPlan[];
    };
    if (!execJson.ok) {
      throw new Error(execJson.error || "Failed to execute store tool call.");
    }

    toolBadges.push(...execJson.badges);
    plans.push(...execJson.plans);
    for (const tr of execJson.toolResults) {
      wireMessages.push({
        role: "tool",
        content: tr.content,
      });
    }
  }

  return {
    reply:
      finalReply ||
      (plans.length > 0
        ? "Preview ready below — review the items and click Apply All."
        : "Completed."),
    toolBadges,
    plans,
    provider: "ollama",
    modelUsed: prepJson.model,
    usedFallback: false,
    rateLimit: {
      limitTokensPerMin: null,
      remainingTokensPerMin: null,
      usedTokensThisTurn: totalTokens,
    },
  };
}
