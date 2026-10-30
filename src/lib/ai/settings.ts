import "server-only";
import { assertAdmin, requireAdmin } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  isAiProviderId,
  isAiReasoningEffort,
  isAiTokenBudgetMode,
  isOllamaMode,
  maskSecretKey,
  type AiProviderId,
  type AiSettingsServer,
  type PublicAiSettings,
} from "@/lib/ai/providers";

export function isMissingAiSettingsSchema(err: unknown): boolean {
  const rec = typeof err === "object" && err !== null ? (err as { code?: unknown; message?: unknown }) : null;
  const code = typeof rec?.code === "string" ? rec.code : "";
  const msg = typeof rec?.message === "string" ? rec.message : err instanceof Error ? err.message : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    /relation "?(public\.)?ai_settings"? does not exist|ai_settings.*schema cache/i.test(msg)
  );
}

function readEnvKey(provider: AiProviderId): string | null {
  const map: Record<AiProviderId, string | undefined> = {
    groq: process.env.GROQ_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    ollama: process.env.OLLAMA_API_KEY,
    custom: process.env.CUSTOM_AI_API_KEY,
  };
  const v = map[provider]?.trim();
  return v ? v : null;
}

export function resolveProviderApiKey(
  settings: AiSettingsServer,
  provider: AiProviderId = settings.provider,
  overrideKey?: string | null,
): string | null {
  if (typeof overrideKey === "string" && overrideKey.trim()) return overrideKey.trim();
  const stored = settings.api_keys[provider]?.trim();
  if (stored) return stored;
  return readEnvKey(provider);
}

function normaliseRow(row: Record<string, unknown> | null): AiSettingsServer {
  if (!row) return { ...DEFAULT_AI_SETTINGS, api_keys: {} };
  const provider: AiProviderId = isAiProviderId(row.provider) ? row.provider : DEFAULT_AI_SETTINGS.provider;
  const providerMeta = AI_PROVIDERS[provider];

  const rawKeys =
    typeof row.api_keys === "object" && row.api_keys !== null && !Array.isArray(row.api_keys)
      ? (row.api_keys as Record<string, unknown>)
      : {};
  const api_keys: Partial<Record<AiProviderId, string>> = {};
  for (const id of AI_PROVIDER_IDS) {
    const val = rawKeys[id];
    if (typeof val === "string" && val.trim()) {
      api_keys[id] = val.trim();
    }
  }

  const tempNum =
    typeof row.temperature === "number"
      ? row.temperature
      : typeof row.temperature === "string"
        ? Number.parseFloat(row.temperature)
        : DEFAULT_AI_SETTINGS.temperature;

  const ctxNum =
    typeof row.ollama_num_ctx === "number"
      ? row.ollama_num_ctx
      : typeof row.ollama_num_ctx === "string"
        ? Number.parseInt(row.ollama_num_ctx, 10)
        : DEFAULT_AI_SETTINGS.ollama_num_ctx;

  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : DEFAULT_AI_SETTINGS.enabled,
    provider,
    primary_model:
      typeof row.primary_model === "string" && row.primary_model.trim()
        ? row.primary_model.trim()
        : providerMeta.defaultPrimaryModel,
    fallback_model:
      typeof row.fallback_model === "string" && row.fallback_model.trim()
        ? row.fallback_model.trim()
        : null,
    custom_base_url:
      typeof row.custom_base_url === "string" && row.custom_base_url.trim()
        ? row.custom_base_url.trim()
        : null,
    ollama_mode: isOllamaMode(row.ollama_mode) ? row.ollama_mode : DEFAULT_AI_SETTINGS.ollama_mode,
    ollama_base_url:
      typeof row.ollama_base_url === "string" && row.ollama_base_url.trim()
        ? row.ollama_base_url.trim()
        : DEFAULT_AI_SETTINGS.ollama_base_url,
    ollama_num_ctx:
      Number.isFinite(ctxNum) && ctxNum >= 2048 && ctxNum <= 131072
        ? Math.round(ctxNum)
        : DEFAULT_AI_SETTINGS.ollama_num_ctx,
    ollama_disable_thinking:
      typeof row.ollama_disable_thinking === "boolean"
        ? row.ollama_disable_thinking
        : DEFAULT_AI_SETTINGS.ollama_disable_thinking,
    token_budget_mode: isAiTokenBudgetMode(row.token_budget_mode)
      ? row.token_budget_mode
      : providerMeta.defaultBudgetMode,
    reasoning_effort: isAiReasoningEffort(row.reasoning_effort)
      ? row.reasoning_effort
      : DEFAULT_AI_SETTINGS.reasoning_effort,
    temperature:
      Number.isFinite(tempNum) && tempNum >= 0 && tempNum <= 2
        ? Math.round(tempNum * 100) / 100
        : DEFAULT_AI_SETTINGS.temperature,
    vision_enabled: typeof row.vision_enabled === "boolean" ? row.vision_enabled : false,
    require_confirmation:
      typeof row.require_confirmation === "boolean" ? row.require_confirmation : true,
    brand_tone:
      typeof row.brand_tone === "string" && row.brand_tone.trim()
        ? row.brand_tone.trim()
        : DEFAULT_AI_SETTINGS.brand_tone,
    default_language:
      typeof row.default_language === "string" && row.default_language.trim()
        ? row.default_language.trim()
        : DEFAULT_AI_SETTINGS.default_language,
    system_instructions:
      typeof row.system_instructions === "string" && row.system_instructions.trim()
        ? row.system_instructions.trim()
        : null,
    api_keys,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export function toPublicAiSettings(s: AiSettingsServer): PublicAiSettings {
  const masked_keys = {} as Record<AiProviderId, string | null>;
  const has_keys = {} as Record<AiProviderId, boolean>;
  const env_keys = {} as Record<AiProviderId, boolean>;

  for (const id of AI_PROVIDER_IDS) {
    const stored = s.api_keys[id]?.trim() || null;
    const env = readEnvKey(id);
    const effective = stored ?? env;
    masked_keys[id] = maskSecretKey(effective);
    has_keys[id] = Boolean(effective);
    env_keys[id] = !stored && Boolean(env);
  }

  const providerMeta = AI_PROVIDERS[s.provider];
  const hasRequiredKey = !providerMeta.requiresApiKey || has_keys[s.provider];
  const hasModel = Boolean(s.primary_model.trim());
  const is_ready = s.enabled && hasRequiredKey && hasModel;

  const { api_keys: _omit, ...rest } = s;
  void _omit;

  return {
    ...rest,
    masked_keys,
    has_keys,
    env_keys,
    is_ready,
  };
}

/** Used in admin page RSCs (redirects non-admins via `requireAdmin`). */
export async function adminGetAiSettings(): Promise<{
  server: AiSettingsServer;
  client: PublicAiSettings;
  migrated: boolean;
}> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (isMissingAiSettingsSchema(error)) {
      const fallback = normaliseRow(null);
      return { server: fallback, client: toPublicAiSettings(fallback), migrated: false };
    }
    throw new Error(`Failed to load AI settings: ${error.message}`);
  }

  const server = normaliseRow((data as Record<string, unknown> | null) ?? null);
  return { server, client: toPublicAiSettings(server), migrated: true };
}

/** Used in API Route Handlers & Server Actions (throws `AdminAuthError` instead of redirecting). */
export async function loadAiSettingsForAction(): Promise<{
  server: AiSettingsServer;
  client: PublicAiSettings;
  migrated: boolean;
}> {
  await assertAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (isMissingAiSettingsSchema(error)) {
      const fallback = normaliseRow(null);
      return { server: fallback, client: toPublicAiSettings(fallback), migrated: false };
    }
    throw new Error(`Failed to load AI settings: ${error.message}`);
  }

  const server = normaliseRow((data as Record<string, unknown> | null) ?? null);
  return { server, client: toPublicAiSettings(server), migrated: true };
}
