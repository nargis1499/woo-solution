export const AI_PROVIDER_IDS = [
  "groq",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "deepseek",
  "ollama",
  "custom",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TOKEN_BUDGET_MODES = ["economy", "standard", "high"] as const;
export type AiTokenBudgetMode = (typeof AI_TOKEN_BUDGET_MODES)[number];

export const AI_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

export const OLLAMA_MODES = ["browser", "tunnel"] as const;
export type OllamaMode = (typeof OLLAMA_MODES)[number];

export type AiModelPreset = {
  id: string;
  label: string;
  badge?: string;
  vision?: boolean;
};

export type AiProviderMeta = {
  id: AiProviderId;
  label: string;
  tierBadge: string;
  description: string;
  defaultBaseUrl: string;
  defaultPrimaryModel: string;
  defaultFallbackModel: string | null;
  defaultBudgetMode: AiTokenBudgetMode;
  requiresApiKey: boolean;
  keyPlaceholder: string;
  consoleUrl?: string;
  models: AiModelPreset[];
};

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  groq: {
    id: "groq",
    label: "Groq Cloud",
    tierBadge: "Free & Paid · Ultra-Fast",
    description: "Instant tool-calling with GPT OSS 120B & 20B. Economy mode keeps usage safely inside 8k TPM.",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultPrimaryModel: "openai/gpt-oss-120b",
    defaultFallbackModel: "openai/gpt-oss-20b",
    defaultBudgetMode: "economy",
    requiresApiKey: true,
    keyPlaceholder: "gsk_...",
    consoleUrl: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B (Recommended Brain)", badge: "Tool-Calling" },
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B (Fast Worker / Fallback)", badge: "1000 tok/s" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", badge: "General" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", badge: "Vision", vision: true },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    tierBadge: "Paid API",
    description: "Industry-standard GPT-4.1, GPT-4o & o-series models with high context and vision support.",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultPrimaryModel: "gpt-4.1",
    defaultFallbackModel: "gpt-4.1-mini",
    defaultBudgetMode: "high",
    requiresApiKey: true,
    keyPlaceholder: "sk-proj-...",
    consoleUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1 (Flagship Tool-Calling)", badge: "1M ctx", vision: true },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini (Fast & Affordable)", badge: "Best Value", vision: true },
      { id: "gpt-4o", label: "GPT-4o", badge: "Multimodal", vision: true },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", badge: "Fast", vision: true },
      { id: "o4-mini", label: "o4-mini (Reasoning)", badge: "Reasoning", vision: true },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    tierBadge: "Paid API",
    description: "Claude Sonnet, Haiku & Opus for top-tier agentic reasoning and nuanced brand copywriting.",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultPrimaryModel: "claude-sonnet-4-5",
    defaultFallbackModel: "claude-haiku-4-5",
    defaultBudgetMode: "high",
    requiresApiKey: true,
    keyPlaceholder: "sk-ant-...",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)", badge: "Agentic", vision: true },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Fast Worker)", badge: "Fast", vision: true },
      { id: "claude-opus-4-5", label: "Claude Opus 4.5 (Max Intelligence)", badge: "Flagship", vision: true },
      { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", badge: "Stable", vision: true },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    tierBadge: "Free Tier & Paid",
    description: "Google AI Studio Gemini 2.5 Flash & Pro with generous free tier, 1M context, and native vision.",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultPrimaryModel: "gemini-2.5-flash",
    defaultFallbackModel: "gemini-2.5-flash-lite",
    defaultBudgetMode: "standard",
    requiresApiKey: true,
    keyPlaceholder: "AIzaSy...",
    consoleUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Recommended)", badge: "Free/Paid", vision: true },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (High Quota)", badge: "Fast", vision: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Deep Reasoning)", badge: "Pro", vision: true },
    ],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    tierBadge: "300+ Free & Paid Models",
    description: "Single API key for hundreds of free (`:free`) and commercial models across every lab.",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultPrimaryModel: "qwen/qwen3-235b-a22b:free",
    defaultFallbackModel: "meta-llama/llama-3.3-70b-instruct:free",
    defaultBudgetMode: "standard",
    requiresApiKey: true,
    keyPlaceholder: "sk-or-v1-...",
    consoleUrl: "https://openrouter.ai/keys",
    models: [
      { id: "qwen/qwen3-235b-a22b:free", label: "Qwen3 235B (Free)", badge: "Free" },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (Free)", badge: "Free" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (via OpenRouter)", badge: "Paid", vision: true },
      { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini (via OpenRouter)", badge: "Paid", vision: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (via OpenRouter)", badge: "Paid", vision: true },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    tierBadge: "Low-Cost API",
    description: "DeepSeek V3 / R1 with strong tool-calling at a fraction of standard API pricing.",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultPrimaryModel: "deepseek-chat",
    defaultFallbackModel: null,
    defaultBudgetMode: "standard",
    requiresApiKey: true,
    keyPlaceholder: "sk-...",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat (V3 · Tool-Calling)", badge: "Recommended" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)", badge: "Reasoning" },
    ],
  },
  ollama: {
    id: "ollama",
    label: "Ollama (Local / Self-Hosted)",
    tierBadge: "Local GPU · $0 · Unlimited",
    description: "Connect local models like Qwen3.5 9B via Browser-Direct localhost or an HTTPS tunnel.",
    defaultBaseUrl: "http://localhost:11434",
    defaultPrimaryModel: "qwen3.5:9b",
    defaultFallbackModel: null,
    defaultBudgetMode: "standard",
    requiresApiKey: false,
    keyPlaceholder: "Optional tunnel bearer token",
    models: [
      { id: "qwen3.5:9b", label: "Qwen3.5 9B (Strong Local Tool-Calling)", badge: "Recommended" },
      { id: "qwen3:8b", label: "Qwen3 8B", badge: "Local" },
      { id: "qwen3:14b", label: "Qwen3 14B", badge: "Local" },
      { id: "qwen2.5:7b", label: "Qwen2.5 7B", badge: "Fast" },
      { id: "llama3.2:latest", label: "Llama 3.2", badge: "Lightweight" },
    ],
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-Compatible)",
    tierBadge: "Any Endpoint",
    description: "Connect vLLM, LM Studio, Together, Fireworks, Mistral, xAI Grok, Azure, or any /v1 endpoint.",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultPrimaryModel: "",
    defaultFallbackModel: null,
    defaultBudgetMode: "standard",
    requiresApiKey: false,
    keyPlaceholder: "Bearer API key (optional)",
    models: [],
  },
};

export function isAiProviderId(v: unknown): v is AiProviderId {
  return typeof v === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(v);
}

export function isAiTokenBudgetMode(v: unknown): v is AiTokenBudgetMode {
  return typeof v === "string" && (AI_TOKEN_BUDGET_MODES as readonly string[]).includes(v);
}

export function isAiReasoningEffort(v: unknown): v is AiReasoningEffort {
  return typeof v === "string" && (AI_REASONING_EFFORTS as readonly string[]).includes(v);
}

export function isOllamaMode(v: unknown): v is OllamaMode {
  return typeof v === "string" && (OLLAMA_MODES as readonly string[]).includes(v);
}

export type AiSettingsServer = {
  enabled: boolean;
  provider: AiProviderId;
  primary_model: string;
  fallback_model: string | null;
  custom_base_url: string | null;
  ollama_mode: OllamaMode;
  ollama_base_url: string;
  ollama_num_ctx: number;
  ollama_disable_thinking: boolean;
  token_budget_mode: AiTokenBudgetMode;
  reasoning_effort: AiReasoningEffort;
  temperature: number;
  vision_enabled: boolean;
  require_confirmation: boolean;
  brand_tone: string;
  default_language: string;
  system_instructions: string | null;
  api_keys: Partial<Record<AiProviderId, string>>;
  updated_at: string | null;
};

/** Safe projection passed to client components — raw API keys are never sent to the browser. */
export type PublicAiSettings = Omit<AiSettingsServer, "api_keys"> & {
  masked_keys: Record<AiProviderId, string | null>;
  has_keys: Record<AiProviderId, boolean>;
  env_keys: Record<AiProviderId, boolean>;
  is_ready: boolean;
};

export const DEFAULT_AI_SETTINGS: AiSettingsServer = {
  enabled: false,
  provider: "groq",
  primary_model: "openai/gpt-oss-120b",
  fallback_model: "openai/gpt-oss-20b",
  custom_base_url: null,
  ollama_mode: "browser",
  ollama_base_url: "http://localhost:11434",
  ollama_num_ctx: 16384,
  ollama_disable_thinking: true,
  token_budget_mode: "economy",
  reasoning_effort: "low",
  temperature: 0.2,
  vision_enabled: false,
  require_confirmation: true,
  brand_tone: "modern",
  default_language: "English",
  system_instructions: null,
  api_keys: {},
  updated_at: null,
};

export function maskSecretKey(raw: string | undefined | null): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
