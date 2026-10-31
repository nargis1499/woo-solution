import { capturingAiFetch, type LogSink } from "@/lib/logs/capture";
import { createUsageCollector } from "@/lib/ai/usage";
import { isStandaloneInventoryReport, isStandaloneOrderReport, type AiResponsePolicy } from "@/lib/ai/response-budget";
import { CONTENT_PREVIEW_REPAIR, needsContentPreviewRepair } from "@/lib/ai/content-fields";
import type { AiToolCall, AiToolSpec } from "@/lib/ai/client";
import type {
  AiActionPlan,
  AiAgentTurnResponse,
  AiChatHistoryItem,
  AiToolBadge,
  AiUiWidget,
} from "@/lib/ai/types";

const browserLogSink: LogSink = {
  async start(entry) {
    const res = await fetch("/api/nemesis/logs/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ phase: "start", trace_id: entry.trace_id, model: entry.model, payload: entry.request_payload }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id: string | null }).id;
  },
  async finish(id, entry) {
    const { response_payload, ...metadata } = entry;
    const res = await fetch("/api/nemesis/logs/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ phase: "finish", id, ...metadata, payload: response_payload }),
    });
    if (!res.ok) console.warn("Browser AI diagnostic update unavailable");
  },
};

const PROMPT_TOOLS_CACHE_KEY = "nemesis_ollama_use_prompt_tools";

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

function extractOllamaError(rawText: string, status: number): string {
  try {
    const parsed = JSON.parse(rawText) as { error?: string; message?: string };
    const errMsg = parsed.error || parsed.message;
    if (typeof errMsg === "string" && errMsg.trim()) {
      return errMsg.trim().slice(0, 700);
    }
  } catch {
    // plain text body
  }
  return rawText.trim().slice(0, 700) || `Ollama HTTP ${status}`;
}

function isLlamaServerCrash(msg: string): boolean {
  return /llama-server process has terminated|0xc0000409|out of memory|cuda error|ggml_assert|failed to allocate/i.test(
    msg,
  );
}

export function formatOllamaCorsError(baseUrl: string, err: unknown): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
    return `Could not reach Ollama at ${baseUrl}. Make sure Ollama is running with CORS enabled (Windows PowerShell: $env:OLLAMA_ORIGINS="*"; ollama serve — or macOS/Linux: OLLAMA_ORIGINS="${origin}" ollama serve).`;
  }
  if (isLlamaServerCrash(msg)) {
    return `Ollama's local llama-server crashed (${msg}). Tip: Update Ollama to the latest version (ollama -v), lower Context Window (num_ctx) to 4096 or 2048 in Settings → AI, or close GPU-heavy apps if VRAM is full.`;
  }
  return msg;
}

/**
 * Fallback tool-calling protocol when Windows `llama-server.exe` crashes (`0xc0000409`)
 * compiling GBNF tool grammars or allocating large KV caches. Sends plain chat without
 * the `tools` parameter and parses structured JSON tool calls directly from the text.
 */
function buildPromptToolsAddendum(tools: AiToolSpec[]): string {
  const compactTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters.properties,
    required: t.parameters.required ?? [],
  }));
  return [
    "",
    "TOOL CALLING FORMAT (IMPORTANT):",
    "You have access to these JSON tools:",
    JSON.stringify(compactTools),
    'When you need to call one or more tools, respond with ONLY valid JSON in this exact shape (no markdown prose before or after):',
    '{"tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}',
    "After receiving [TOOL_RESULT] messages, write a concise plain-text summary for the admin (do NOT output tool_calls JSON again unless another tool is strictly needed).",
  ].join("\n");
}

function parsePromptToolCalls(content: string, round: number): AiToolCall[] {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates: string[] = [cleaned];
  const braceMatch = cleaned.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (braceMatch) candidates.unshift(braceMatch[0]);

  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as {
        tool_calls?: Array<{ name?: string; arguments?: unknown }>;
      };
      if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
        return parsed.tool_calls
          .filter((tc) => typeof tc.name === "string" && Boolean(tc.name.trim()))
          .map((tc, idx) => ({
            id: `ollama_ptc_${round}_${idx}`,
            name: tc.name!.trim(),
            arguments: parseArgs(tc.arguments),
          }));
      }
    } catch {
      // ignore non-JSON assistant reply
    }
  }
  return [];
}

function getRememberedPromptToolsFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PROMPT_TOOLS_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPromptToolsFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROMPT_TOOLS_CACHE_KEY, "1");
  } catch {
    // ignore
  }
}

async function postOllamaChatWithRecovery(opts: {
  traceId: string;
  root: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  ollamaTools?: Array<Record<string, unknown>>;
  numCtx: number;
  disableThinking: boolean;
  temperature: number;
}): Promise<{
  usedPromptToolsFallback: boolean;
  data: {
    model?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    message?: {
      content?: string;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: unknown };
      }>;
    };
  };
}> {
  const loggedFetch = capturingAiFetch(
    { trace_id: opts.traceId, provider: "ollama", model: opts.model, source: "browser" },
    browserLogSink,
  );
  const safeNumCtx = Math.min(opts.numCtx || 4096, 32768);

  const sendOnce = async (payload: Record<string, unknown>) => {
    const res = await loggedFetch(`${opts.root}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(extractOllamaError(txt, res.status));
    }
    return (await res.json()) as {
      model?: string;
      prompt_eval_count?: number;
      eval_count?: number;
      message?: {
        content?: string;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: unknown };
        }>;
      };
    };
  };

  // Attempt 1: Normal call (unless session already detected Windows GBNF `tools` crash)
  const skipNativeTools = Boolean(opts.ollamaTools?.length) && getRememberedPromptToolsFlag();

  if (!skipNativeTools) {
    try {
      const data = await sendOnce({
        model: opts.model,
        stream: false,
        ...(opts.disableThinking ? { think: false } : {}),
        options: { num_ctx: safeNumCtx, temperature: opts.temperature },
        messages: opts.messages,
        ...(opts.ollamaTools?.length ? { tools: opts.ollamaTools } : {}),
      });
      return { usedPromptToolsFallback: false, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isLlamaServerCrash(msg) && !/think|unknown|invalid/i.test(msg)) {
        throw err;
      }
      // Fall through to low-VRAM / no-GBNF-grammar recovery below!
    }
  }

  // Attempt 2: Drop native `tools` (avoids Windows llama-server 1MB stack buffer overrun 0xc0000409
  // in GBNF grammar compilation) and cap `num_ctx` to 4096 so 6–8GB GPUs don't OOM.
  try {
    const fallbackCtx = Math.min(safeNumCtx, 4096);
    const data = await sendOnce({
      model: opts.model,
      stream: false,
      ...(opts.disableThinking ? { think: false } : {}),
      options: { num_ctx: fallbackCtx, temperature: opts.temperature },
      messages: opts.messages,
    });
    if (opts.ollamaTools?.length) rememberPromptToolsFlag();
    return { usedPromptToolsFallback: true, data };
  } catch (err2) {
    const msg2 = err2 instanceof Error ? err2.message : String(err2);
    if (!isLlamaServerCrash(msg2) && !/think/i.test(msg2)) {
      throw err2;
    }
  }

  // Attempt 3: Ultra-minimal 2048 context without `think` flag (recovers on tight VRAM / older Ollama)
  const data = await sendOnce({
    model: opts.model,
    stream: false,
    options: { num_ctx: 2048, temperature: opts.temperature },
    messages: opts.messages,
  });
  if (opts.ollamaTools?.length) rememberPromptToolsFlag();
  return { usedPromptToolsFallback: true, data };
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
  const dummyTool: AiToolSpec = {
    name: "verify_agent_ready",
    description: "Confirms local Ollama tool-calling works.",
    parameters: {
      type: "object",
      properties: { ok: { type: "boolean" } },
    },
  };

  try {
    const result = await postOllamaChatWithRecovery({
      traceId: crypto.randomUUID(),
      root,
      model: opts.model,
      numCtx: opts.numCtx || 4096,
      disableThinking: opts.disableThinking,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Call verify_agent_ready or reply Ready.${buildPromptToolsAddendum([dummyTool])}`,
        },
        {
          role: "user",
          content: "Ping check.",
        },
      ],
      ollamaTools: [
        {
          type: "function",
          function: dummyTool,
        },
      ],
    });

    const nativeVerified =
      Array.isArray(result.data.message?.tool_calls) &&
      result.data.message.tool_calls.length > 0;
    const promptVerified =
      parsePromptToolCalls(result.data.message?.content ?? "", 0).length > 0;

    return {
      latencyMs: Date.now() - started,
      modelUsed: result.data.model || opts.model,
      toolCallingVerified: nativeVerified || promptVerified || result.usedPromptToolsFallback,
    };
  } catch (err) {
    throw new Error(formatOllamaCorsError(root, err));
  }
}

export async function runBrowserOllamaAgentTurn(opts: {
  prompt: string;
  currentPath?: string;
  history: AiChatHistoryItem[];
}): Promise<AiAgentTurnResponse> {
  const traceId = crypto.randomUUID();
  const prepRes = await fetch("/api/nemesis/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase: "ollama_prepare", currentPath: opts.currentPath, prompt: opts.prompt, history: opts.history.slice(-6) }),
  });
  const prepJson = (await prepRes.json()) as {
    ok: boolean;
    error?: string;
    systemPrompt: string;
    simpleConversation?: boolean;
    history?: AiChatHistoryItem[];
    contextMode?: "greeting" | "scoped" | "full";
    responsePolicy: AiResponsePolicy;
    language: string;
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

  let usePromptMode = prepJson.tools.length > 0 && getRememberedPromptToolsFlag();

  const buildSystemContent = (promptMode: boolean) =>
    promptMode && prepJson.tools.length > 0
      ? `${prepJson.systemPrompt}\n${buildPromptToolsAddendum(prepJson.tools)}`
      : prepJson.systemPrompt;

  const wireMessages: Array<Record<string, unknown>> = [
    { role: "system", content: buildSystemContent(usePromptMode) },
    ...(prepJson.simpleConversation ? [] : (prepJson.history ?? opts.history).slice(-6).map((h) => ({ role: h.role, content: h.content }))),
    { role: "user", content: opts.prompt },
  ];

  const toolBadges: AiToolBadge[] = [];
  const plans: AiActionPlan[] = [];
  const widgets: AiUiWidget[] = [];
  let totalTokens = 0;
  const usage = createUsageCollector();
  function recordUsage(data: Awaited<ReturnType<typeof postOllamaChatWithRecovery>>["data"]) {
    const input = data.prompt_eval_count ?? 0;
    const output = data.eval_count ?? 0;
    usage.record({ modelUsed: data.model || prepJson.model, usage: { promptTokens: input, completionTokens: output, totalTokens: input + output, reported: typeof data.prompt_eval_count === "number" && typeof data.eval_count === "number" } });
    totalTokens += input + output;
  }
  const usageContext = { contextMode: prepJson.contextMode ?? (prepJson.simpleConversation ? "greeting" as const : "full" as const), toolCount: prepJson.tools.length, historyMessages: wireMessages.length - 2 };
  let finalReply = "";
  let repairedContentPreview = false;

  for (let round = 0; round <= 3; round++) {
    let turnResult: Awaited<ReturnType<typeof postOllamaChatWithRecovery>>;
    try {
      turnResult = await postOllamaChatWithRecovery({
        traceId,
        root,
        model: prepJson.model,
        messages: wireMessages,
        ollamaTools: !usePromptMode && round < 3 && ollamaTools.length > 0 ? ollamaTools : undefined,
        numCtx: prepJson.numCtx || 4096,
        disableThinking: prepJson.disableThinking,
        temperature: 0.2,
      });

      recordUsage(turnResult.data);
      // If native `tools` crashed on round 0 and recovered without prompt instructions yet,
      // re-run round 0 once with the JSON tool schema instructions in the system prompt!
      if (prepJson.tools.length > 0 && turnResult.usedPromptToolsFallback && !usePromptMode && round === 0) {
        usePromptMode = true;
        wireMessages[0] = { role: "system", content: buildSystemContent(true) };
        turnResult = await postOllamaChatWithRecovery({
          traceId,
          root,
          model: prepJson.model,
          messages: wireMessages,
          numCtx: Math.min(prepJson.numCtx || 4096, 4096),
          disableThinking: prepJson.disableThinking,
          temperature: 0.2,
        });
        recordUsage(turnResult.data);
      }
    } catch (err) {
      throw new Error(formatOllamaCorsError(root, err));
    }

    const chatJson = turnResult.data;

    const content = (chatJson.message?.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    const rawNativeCalls = chatJson.message?.tool_calls ?? [];
    let parsedCalls: AiToolCall[] = rawNativeCalls
      .filter((c) => Boolean(c.function?.name))
      .map((c, idx) => ({
        id: `ollama_tc_${round}_${idx}`,
        name: c.function!.name!,
        arguments: parseArgs(c.function?.arguments),
      }));

    if (prepJson.simpleConversation) {
      finalReply = content;
      break;
    }

    if (parsedCalls.length === 0 && round < 3) {
      parsedCalls = parsePromptToolCalls(content, round);
    }

    if (parsedCalls.length === 0 && round < 3 && plans.length === 0 && !repairedContentPreview && needsContentPreviewRepair(opts.prompt, content)) {
      repairedContentPreview = true;
      wireMessages.push({ role: "assistant", content });
      wireMessages.push({ role: "user", content: CONTENT_PREVIEW_REPAIR });
      round--;
      continue;
    }

    if (parsedCalls.length === 0 || round === 3) {
      finalReply = content;
      break;
    }

    if (rawNativeCalls.length > 0 && !usePromptMode) {
      wireMessages.push({
        role: "assistant",
        content: content || "",
        tool_calls: rawNativeCalls,
      });
    } else {
      wireMessages.push({
        role: "assistant",
        content: JSON.stringify({
          tool_calls: parsedCalls.map((c) => ({ name: c.name, arguments: c.arguments })),
        }),
      });
    }

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
      completionSummaries?: string[];
      toolResults: Array<{ toolCallId: string; name: string; content: string }>;
      badges: AiToolBadge[];
      plans: AiActionPlan[];
      widgets?: AiUiWidget[];
    };
    if (!execJson.ok) {
      throw new Error(execJson.error || "Failed to execute store tool call.");
    }

    toolBadges.push(...execJson.badges);
    plans.push(...execJson.plans);
    if (execJson.widgets) widgets.push(...execJson.widgets);
    if (prepJson.responsePolicy.mode === "compact" && parsedCalls.length === 1 &&
        ((isStandaloneInventoryReport(opts.prompt) && parsedCalls[0].name === "analyze_inventory_intelligence") ||
         (isStandaloneOrderReport(opts.prompt) && parsedCalls[0].name === "query_order_intelligence")) &&
        execJson.completionSummaries?.length === parsedCalls.length && plans.length === 0 && prepJson.language.toLowerCase().startsWith("en")) {
      finalReply = execJson.completionSummaries.slice(0, 2).join(" ");
      break;
    }
    for (const tr of execJson.toolResults) {
      if (rawNativeCalls.length > 0 && !usePromptMode) {
        wireMessages.push({
          role: "tool",
          tool_name: tr.name,
          content: tr.content,
        });
      } else {
        wireMessages.push({
          role: "user",
          content: `[TOOL_RESULT name="${tr.name}"]: ${tr.content}`,
        });
      }
    }
  }

  return {
    reply:
      finalReply ||
      (plans.length > 0
        ? "Let me know if you'd like to adjust any selections before applying!"
        : "Let me know if you'd like to adjust any catalog details!"),
    toolBadges,
    plans,
    widgets,
    provider: "ollama",
    usage: usage.snapshot(usageContext),
    modelUsed: prepJson.model,
    usedFallback: false,
    rateLimit: {
      limitTokensPerMin: null,
      remainingTokensPerMin: null,
      usedTokensThisTurn: totalTokens,
    },
  };
}
