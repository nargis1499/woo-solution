import { NextResponse } from "next/server";
import { AdminAuthError } from "@/lib/admin/auth";
import { fetchProviderModels, runModelCompletion } from "@/lib/ai/client";
import { AI_PROVIDERS, isAiProviderId } from "@/lib/ai/providers";
import { loadAiSettingsForAction } from "@/lib/ai/settings";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { server } = await loadAiSettingsForAction();
    const body = (await request.json()) as {
      action?: "list_models" | "test_connection";
      provider?: string;
      model?: string;
      apiKey?: string | null;
      baseUrl?: string | null;
    };

    const provider = isAiProviderId(body.provider) ? body.provider : server.provider;
    const apiKeyOverride = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : null;
    const baseUrlOverride = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : null;

    if (body.action === "list_models") {
      const models = await fetchProviderModels({
        settings: server,
        provider,
        apiKeyOverride,
        baseUrlOverride,
      });
      return NextResponse.json({ ok: true, models });
    }

    const modelToTest =
      (typeof body.model === "string" && body.model.trim()) ||
      server.primary_model ||
      AI_PROVIDERS[provider].defaultPrimaryModel;

    const started = Date.now();
    const result = await runModelCompletion({
      settings: server,
      overrideProvider: provider,
      overrideModel: modelToTest,
      overrideApiKey: apiKeyOverride,
      overrideBaseUrl: baseUrlOverride,
      systemPrompt:
        "You are Nemesis AI diagnostic check. Call the `verify_agent_ready` tool or reply with a short confirmation.",
      messages: [
        {
          role: "user",
          content: "Verify connection and tool-calling readiness.",
        },
      ],
      tools: [
        {
          name: "verify_agent_ready",
          description: "Confirms tool-calling works on this provider and model.",
          parameters: {
            type: "object",
            properties: {
              ok: { type: "boolean", description: "Always true" },
            },
          },
        },
      ],
    });
    const latencyMs = Date.now() - started;

    return NextResponse.json({
      ok: true,
      latencyMs,
      modelUsed: result.modelUsed,
      toolCallingVerified: result.toolCalls.length > 0,
      reply: result.text || "Ready for tool-calling.",
      rateLimit: result.rateLimit,
    });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "AI provider request failed.",
      },
      { status: 400 },
    );
  }
}
