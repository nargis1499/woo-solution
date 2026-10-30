import "server-only";
import {
  AI_PROVIDERS,
  type AiProviderId,
  type AiReasoningEffort,
  type AiSettingsServer,
} from "@/lib/ai/providers";
import { resolveProviderApiKey } from "@/lib/ai/settings";

/* ──────────────────────────────────────────────────────────────────────────
 * Universal Multi-Provider Tool-Calling Client (Web `fetch` only)
 * Works identically on Cloudflare Workers, Vercel Functions, and Node.js:
 *  - OpenAI-Compatible: Groq (GPT OSS 120B/20B), OpenAI, OpenRouter,
 *    DeepSeek, Ollama (HTTPS Tunnel), and Custom /v1 endpoints
 *  - Anthropic Messages API: Claude Sonnet, Haiku, Opus
 *  - Google Gemini API: Gemini 2.5 Flash, Flash-Lite, Pro
 * ────────────────────────────────────────────────────────────────────────── */

export type AiToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type AiToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Preserved when Gemini 2.5 thinking models return a signature on functionCall parts. */
  thoughtSignature?: string;
};

export type AiTurnMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AiRateLimitInfo = {
  limitTokensPerMin?: number | null;
  remainingTokensPerMin?: number | null;
  usedTokensThisTurn: number;
};

export type AiCompletionResult = {
  text: string;
  toolCalls: AiToolCall[];
  modelUsed: string;
  usedFallback: boolean;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rateLimit: AiRateLimitInfo;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveBaseUrl(settings: AiSettingsServer, provider: AiProviderId = settings.provider): string {
  if (provider === "ollama") {
    const raw = trimSlash(settings.ollama_base_url || AI_PROVIDERS.ollama.defaultBaseUrl);
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
  }
  if (provider === "custom") {
    return trimSlash(settings.custom_base_url || AI_PROVIDERS.custom.defaultBaseUrl);
  }
  if (settings.custom_base_url && provider === settings.provider) {
    return trimSlash(settings.custom_base_url);
  }
  return trimSlash(AI_PROVIDERS[provider].defaultBaseUrl);
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
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
      // ignore malformed JSON snippet
    }
  }
  return {};
}

function parseHeaderInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

class ProviderHttpError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, message: string, bodyText: string) {
    super(message);
    this.status = status;
    this.bodyText = bodyText;
  }
}

function extractApiErrorMessage(bodyText: string, status: number): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed?.error === "string") return parsed.error;
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // plain text body
  }
  return bodyText.slice(0, 280) || `Provider returned HTTP ${status}`;
}

/* ── 1. OpenAI-Compatible Adapter (Groq, OpenAI, OpenRouter, DeepSeek, Ollama Tunnel, Custom) ── */

async function callOpenAiCompatible(opts: {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  systemPrompt: string;
  messages: AiTurnMessage[];
  tools: AiToolSpec[];
  temperature: number;
  reasoningEffort: AiReasoningEffort;
  maxTokens: number;
  ollamaNumCtx?: number;
  ollamaDisableThinking?: boolean;
}): Promise<Omit<AiCompletionResult, "usedFallback">> {
  const endpoint = `${trimSlash(opts.baseUrl)}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  if (opts.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nemesis-admin.local";
    headers["X-Title"] = "Nemesis Admin AI";
  }

  const isReasoningModel =
    /^(o1|o3|o4|gpt-5)/i.test(opts.model) ||
    /gpt-oss/i.test(opts.model) ||
    /reasoner/i.test(opts.model);

  const systemContent =
    opts.provider === "ollama" && opts.ollamaDisableThinking && /^qwen3(?!\.)/i.test(opts.model)
      ? `${opts.systemPrompt}\n/no_think`
      : opts.systemPrompt;

  const wireMessages: Record<string, unknown>[] = [{ role: "system", content: systemContent }];

  for (const m of opts.messages) {
    if (m.role === "user") {
      wireMessages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content: m.content || (m.toolCalls?.length ? null : ""),
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        entry.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        }));
      }
      wireMessages.push(entry);
    } else if (m.role === "tool") {
      wireMessages.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        name: m.name,
        content: m.content,
      });
    }
  }

  const buildPayload = (includeReasoningEffort: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      model: opts.model,
      messages: wireMessages,
      max_tokens: opts.maxTokens,
    };
    if (!/^(o1|o3|o4)/i.test(opts.model)) {
      payload.temperature = opts.temperature;
    }
    if (includeReasoningEffort && isReasoningModel && opts.provider !== "deepseek") {
      payload.reasoning_effort = opts.reasoningEffort;
    }
    if (opts.tools.length > 0) {
      payload.tools = opts.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      payload.tool_choice = "auto";
    }
    if (opts.provider === "ollama") {
      payload.options = { num_ctx: opts.ollamaNumCtx ?? 4096 };
      if (opts.ollamaDisableThinking) {
        payload.think = false;
      }
    }
    return payload;
  };

  let res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildPayload(true)),
  });

  // If a provider/model rejects `reasoning_effort`, retry cleanly without it.
  if (!res.ok && res.status === 400 && isReasoningModel) {
    const firstErr = await res.text();
    if (/reasoning_effort|unknown|unrecognized|not supported/i.test(firstErr)) {
      res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(buildPayload(false)),
      });
    } else {
      throw new ProviderHttpError(res.status, extractApiErrorMessage(firstErr, res.status), firstErr);
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderHttpError(res.status, extractApiErrorMessage(errText, res.status), errText);
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const choice = json.choices?.[0]?.message;
  const rawCalls = choice?.tool_calls ?? [];
  const toolCalls: AiToolCall[] = rawCalls
    .filter((tc) => Boolean(tc.function?.name))
    .map((tc, idx) => ({
      id: tc.id || `call_${idx + 1}`,
      name: tc.function!.name!,
      arguments: parseJsonObject(tc.function?.arguments),
    }));

  const promptTokens = json.usage?.prompt_tokens ?? 0;
  const completionTokens = json.usage?.completion_tokens ?? 0;
  const totalTokens = json.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    text: (choice?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
    toolCalls,
    modelUsed: json.model || opts.model,
    usage: { promptTokens, completionTokens, totalTokens },
    rateLimit: {
      limitTokensPerMin: parseHeaderInt(res.headers, "x-ratelimit-limit-tokens"),
      remainingTokensPerMin: parseHeaderInt(res.headers, "x-ratelimit-remaining-tokens"),
      usedTokensThisTurn: totalTokens,
    },
  };
}

/* ── 2. Anthropic Messages Adapter (Claude) ──────────────────────────────── */

async function callAnthropic(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiTurnMessage[];
  tools: AiToolSpec[];
  temperature: number;
  maxTokens: number;
}): Promise<Omit<AiCompletionResult, "usedFallback">> {
  const endpoint = `${trimSlash(opts.baseUrl)}/messages`;

  const wireMessages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const m of opts.messages) {
    if (m.role === "user") {
      wireMessages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: Record<string, unknown>[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments ?? {},
        });
      }
      if (blocks.length > 0) wireMessages.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      const resultBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const prev = wireMessages[wireMessages.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        (prev.content as unknown[]).push(resultBlock);
      } else {
        wireMessages.push({ role: "user", content: [resultBlock] });
      }
    }
  }

  const payload: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: Math.min(1, opts.temperature),
    system: opts.systemPrompt,
    messages: wireMessages,
  };
  if (opts.tools.length > 0) {
    payload.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderHttpError(res.status, extractApiErrorMessage(errText, res.status), errText);
  }

  const json = (await res.json()) as {
    model?: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  let text = "";
  const toolCalls: AiToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text" && block.text) {
      text += (text ? "\n" : "") + block.text;
    } else if (block.type === "tool_use" && block.name) {
      toolCalls.push({
        id: block.id || `toolu_${toolCalls.length + 1}`,
        name: block.name,
        arguments: parseJsonObject(block.input),
      });
    }
  }

  const promptTokens = json.usage?.input_tokens ?? 0;
  const completionTokens = json.usage?.output_tokens ?? 0;
  const totalTokens = promptTokens + completionTokens;

  return {
    text: text.trim(),
    toolCalls,
    modelUsed: json.model || opts.model,
    usage: { promptTokens, completionTokens, totalTokens },
    rateLimit: {
      limitTokensPerMin: parseHeaderInt(res.headers, "anthropic-ratelimit-tokens-limit"),
      remainingTokensPerMin: parseHeaderInt(res.headers, "anthropic-ratelimit-tokens-remaining"),
      usedTokensThisTurn: totalTokens,
    },
  };
}

/* ── 3. Google Gemini Adapter (`generateContent`) ────────────────────────── */

async function callGemini(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiTurnMessage[];
  tools: AiToolSpec[];
  temperature: number;
  maxTokens: number;
}): Promise<Omit<AiCompletionResult, "usedFallback">> {
  const cleanModel = opts.model.replace(/^models\//, "");
  const endpoint = `${trimSlash(opts.baseUrl)}/models/${encodeURIComponent(cleanModel)}:generateContent`;

  const contents: Array<{ role: "user" | "model"; parts: Record<string, unknown>[] }> = [];
  for (const m of opts.messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({
          functionCall: { name: tc.name, args: tc.arguments ?? {} },
          ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
        });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      let responseObj: Record<string, unknown> = { result: m.content };
      try {
        const parsed = JSON.parse(m.content);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          responseObj = parsed as Record<string, unknown>;
        }
      } catch {
        // wrap string result
      }
      const fnPart = {
        functionResponse: {
          name: m.name,
          response: responseObj,
        },
      };
      const prev = contents[contents.length - 1];
      if (prev && prev.role === "user" && prev.parts.some((p) => "functionResponse" in p)) {
        prev.parts.push(fnPart);
      } else {
        contents.push({ role: "user", parts: [fnPart] });
      }
    }
  }

  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.systemPrompt }] },
    contents,
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    },
  };
  if (opts.tools.length > 0) {
    payload.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": opts.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderHttpError(res.status, extractApiErrorMessage(errText, res.status), errText);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
          thoughtSignature?: string;
          functionCall?: { name?: string; args?: unknown };
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  let text = "";
  const toolCalls: AiToolCall[] = [];
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    if (part.text && !part.thought) {
      text += (text ? "\n" : "") + part.text;
    }
    if (part.functionCall?.name) {
      toolCalls.push({
        id: `gemini_call_${toolCalls.length + 1}`,
        name: part.functionCall.name,
        arguments: parseJsonObject(part.functionCall.args),
        thoughtSignature: part.thoughtSignature,
      });
    }
  }

  const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens = json.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;

  return {
    text: text.trim(),
    toolCalls,
    modelUsed: cleanModel,
    usage: { promptTokens, completionTokens, totalTokens },
    rateLimit: {
      limitTokensPerMin: null,
      remainingTokensPerMin: null,
      usedTokensThisTurn: totalTokens,
    },
  };
}

/* ── Unified Entrypoint + Automatic Fallback Failover ────────────────────── */

export async function runModelCompletion(opts: {
  settings: AiSettingsServer;
  systemPrompt: string;
  messages: AiTurnMessage[];
  tools?: AiToolSpec[];
  preferWorkerModel?: boolean;
  overrideProvider?: AiProviderId;
  overrideModel?: string;
  overrideApiKey?: string | null;
  overrideBaseUrl?: string | null;
}): Promise<AiCompletionResult> {
  const provider = opts.overrideProvider ?? opts.settings.provider;
  const providerMeta = AI_PROVIDERS[provider];
  const apiKey = resolveProviderApiKey(opts.settings, provider, opts.overrideApiKey);

  if (providerMeta.requiresApiKey && !apiKey) {
    throw new Error(
      `No API key configured for ${providerMeta.label}. Add your key in Settings → AI first.`,
    );
  }

  const baseUrl = opts.overrideBaseUrl?.trim()
    ? trimSlash(opts.overrideBaseUrl.trim())
    : resolveBaseUrl(opts.settings, provider);

  const primaryModel = (opts.overrideModel ?? opts.settings.primary_model).trim();
  const fallbackModel = opts.settings.fallback_model?.trim() || null;

  const chosenFirst =
    opts.preferWorkerModel && fallbackModel ? fallbackModel : primaryModel;
  const chosenSecond =
    chosenFirst === primaryModel && fallbackModel && fallbackModel !== primaryModel
      ? fallbackModel
      : chosenFirst !== primaryModel
        ? primaryModel
        : null;

  const maxTokens =
    opts.settings.token_budget_mode === "economy"
      ? 900
      : opts.settings.token_budget_mode === "standard"
        ? 1800
        : 3200;

  const invokeOnce = async (model: string) => {
    if (provider === "anthropic") {
      return callAnthropic({
        baseUrl,
        apiKey: apiKey!,
        model,
        systemPrompt: opts.systemPrompt,
        messages: opts.messages,
        tools: opts.tools ?? [],
        temperature: opts.settings.temperature,
        maxTokens,
      });
    }
    if (provider === "gemini") {
      return callGemini({
        baseUrl,
        apiKey: apiKey!,
        model,
        systemPrompt: opts.systemPrompt,
        messages: opts.messages,
        tools: opts.tools ?? [],
        temperature: opts.settings.temperature,
        maxTokens,
      });
    }
    return callOpenAiCompatible({
      provider,
      baseUrl,
      apiKey,
      model,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      tools: opts.tools ?? [],
      temperature: opts.settings.temperature,
      reasoningEffort: opts.settings.reasoning_effort,
      maxTokens,
      ollamaNumCtx: opts.settings.ollama_num_ctx,
      ollamaDisableThinking: opts.settings.ollama_disable_thinking,
    });
  };

  try {
    const res = await invokeOnce(chosenFirst);
    return { ...res, usedFallback: chosenFirst !== primaryModel };
  } catch (err) {
    const isRateOrOverload =
      err instanceof ProviderHttpError &&
      (err.status === 429 || err.status === 503 || err.status === 529);
    if (isRateOrOverload && chosenSecond) {
      const retryRes = await invokeOnce(chosenSecond);
      return { ...retryRes, usedFallback: true };
    }
    throw err;
  }
}

/* ── Live Model Discovery & Connection Ping for Settings → AI ────────────── */

export async function fetchProviderModels(opts: {
  settings: AiSettingsServer;
  provider?: AiProviderId;
  apiKeyOverride?: string | null;
  baseUrlOverride?: string | null;
}): Promise<string[]> {
  const provider = opts.provider ?? opts.settings.provider;
  const apiKey = resolveProviderApiKey(opts.settings, provider, opts.apiKeyOverride);
  const baseUrl = opts.baseUrlOverride?.trim()
    ? trimSlash(opts.baseUrlOverride.trim())
    : resolveBaseUrl(opts.settings, provider);

  if (provider === "anthropic") {
    if (!apiKey) throw new Error("Enter an Anthropic API key first.");
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(extractApiErrorMessage(t, res.status));
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  }

  if (provider === "gemini") {
    if (!apiKey) throw new Error("Enter a Google Gemini API key first.");
    const res = await fetch(`${baseUrl}/models`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(extractApiErrorMessage(t, res.status));
    }
    const json = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (json.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }

  if (provider === "ollama") {
    const rootUrl = baseUrl.replace(/\/v1$/, "");
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${rootUrl}/api/tags`, { headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(extractApiErrorMessage(t, res.status));
    }
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(extractApiErrorMessage(t, res.status));
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, 150);
}
