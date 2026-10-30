"use server";

import { revalidatePath } from "next/cache";
import { adminClient, friendlyError } from "@/lib/admin/form";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  isAiProviderId,
  isAiReasoningEffort,
  isAiTokenBudgetMode,
  isOllamaMode,
  type AiProviderId,
  type PublicAiSettings,
} from "@/lib/ai/providers";
import {
  isMissingAiSettingsSchema,
  loadAiSettingsForAction,
  toPublicAiSettings,
} from "@/lib/ai/settings";

export type SaveAiSettingsInput = {
  enabled: boolean;
  provider: string;
  primary_model: string;
  fallback_model: string | null;
  custom_base_url: string | null;
  ollama_mode: string;
  ollama_base_url: string;
  ollama_num_ctx: number;
  ollama_disable_thinking: boolean;
  token_budget_mode: string;
  reasoning_effort: string;
  temperature: number;
  vision_enabled: boolean;
  require_confirmation: boolean;
  brand_tone: string;
  default_language: string;
  system_instructions: string | null;
  /**
   * Per-provider key changes:
   *  - key omitted (`undefined`) -> keep existing stored secret untouched
   *  - `null` or `""` -> clear stored secret for that provider
   *  - non-empty string -> replace stored secret for that provider
   */
  keyChanges?: Partial<Record<AiProviderId, string | null>>;
};

export async function saveAiSettingsAction(
  input: SaveAiSettingsInput,
): Promise<{ ok: true; settings: PublicAiSettings } | { ok: false; error: string }> {
  try {
    const { supabase } = await adminClient();
    const current = await loadAiSettingsForAction();
    if (!current.migrated) {
      return {
        ok: false,
        error:
          "Run supabase/migrations/20261049000000_ai_settings.sql in the Supabase SQL Editor first to enable AI settings storage.",
      };
    }

    const provider: AiProviderId = isAiProviderId(input.provider)
      ? input.provider
      : current.server.provider;
    const providerMeta = AI_PROVIDERS[provider];

    const primaryModel = input.primary_model.trim().slice(0, 160) || providerMeta.defaultPrimaryModel;
    if (!primaryModel) {
      return { ok: false, error: "Please enter or choose a primary model ID." };
    }

    const fallbackModel = input.fallback_model?.trim().slice(0, 160) || null;
    const customBaseUrl = input.custom_base_url?.trim().slice(0, 300) || null;
    if (customBaseUrl && !/^https?:\/\//i.test(customBaseUrl)) {
      return { ok: false, error: "Custom Base URL must start with http:// or https://." };
    }

    const ollamaBaseUrl =
      input.ollama_base_url.trim().slice(0, 300) || AI_PROVIDERS.ollama.defaultBaseUrl;
    if (!/^https?:\/\//i.test(ollamaBaseUrl)) {
      return { ok: false, error: "Ollama URL must start with http:// or https://." };
    }

    const mergedKeys: Partial<Record<AiProviderId, string>> = { ...current.server.api_keys };
    if (input.keyChanges) {
      for (const id of AI_PROVIDER_IDS) {
        if (Object.prototype.hasOwnProperty.call(input.keyChanges, id)) {
          const val = input.keyChanges[id];
          if (typeof val === "string" && val.trim()) {
            mergedKeys[id] = val.trim().slice(0, 400);
          } else {
            delete mergedKeys[id];
          }
        }
      }
    }

    const numCtx = Math.max(
      2048,
      Math.min(131072, Math.round(Number(input.ollama_num_ctx) || 4096)),
    );
    const temp = Math.max(
      0,
      Math.min(2, Math.round((Number(input.temperature) || 0.2) * 100) / 100),
    );

    const row = {
      id: 1,
      enabled: Boolean(input.enabled),
      provider,
      primary_model: primaryModel,
      fallback_model: fallbackModel,
      custom_base_url: customBaseUrl,
      ollama_mode: isOllamaMode(input.ollama_mode) ? input.ollama_mode : "browser",
      ollama_base_url: ollamaBaseUrl,
      ollama_num_ctx: numCtx,
      ollama_disable_thinking: Boolean(input.ollama_disable_thinking),
      token_budget_mode: isAiTokenBudgetMode(input.token_budget_mode)
        ? input.token_budget_mode
        : providerMeta.defaultBudgetMode,
      reasoning_effort: isAiReasoningEffort(input.reasoning_effort)
        ? input.reasoning_effort
        : "low",
      temperature: temp,
      vision_enabled: Boolean(input.vision_enabled),
      require_confirmation: Boolean(input.require_confirmation),
      brand_tone: input.brand_tone.trim().slice(0, 60) || "modern",
      default_language: input.default_language.trim().slice(0, 60) || "English",
      system_instructions: input.system_instructions?.trim().slice(0, 2000) || null,
      api_keys: mergedKeys,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("ai_settings").upsert(row, { onConflict: "id" });
    if (error) {
      if (isMissingAiSettingsSchema(error)) {
        return {
          ok: false,
          error:
            "Run supabase/migrations/20261049000000_ai_settings.sql in the Supabase SQL Editor first.",
        };
      }
      return { ok: false, error: friendlyError(error) };
    }

    revalidatePath("/nemesis", "layout");
    revalidatePath("/nemesis/settings");

    return {
      ok: true,
      settings: toPublicAiSettings({
        ...row,
        api_keys: mergedKeys,
      }),
    };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}
