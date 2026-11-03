import { NextResponse } from "next/server";
import { AdminAuthError, assertAdmin } from "@/lib/admin/auth";
import { runModelCompletion } from "@/lib/ai/client";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { loadAiSettingsForAction } from "@/lib/ai/settings";
import { getProducts } from "@/lib/data/products";
import type { MediaVariant } from "@/lib/types";
import { mediaUrl } from "@/lib/media/shared";
import {
  AI_DESIGN_SYSTEM_PROMPT,
  designPreviewHtml,
  validateAiDesign,
  type DesignMedia,
} from "@/lib/pages/ai-design";
import { sanitizePageHtml } from "@/lib/pages/sanitize";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

// Best-effort per-instance guard; provider quotas remain authoritative across replicas.
const generations = new Map<string, number>();
function allowGeneration(userId: string) {
  const now = Date.now();
  for (const [id, until] of generations)
    if (until < now) generations.delete(id);
  if ((generations.get(userId) ?? 0) > now) return false;
  generations.set(userId, now + 15_000);
  return true;
}

async function availableMedia(): Promise<DesignMedia[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media")
    .select("id, name, path, alt, width, height, variants")
    .eq("kind", "image")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error("Could not load available images.");
  return (data ?? []).map((m) => {
    const variants = m.variants as {
      large?: MediaVariant;
      medium?: MediaVariant;
    } | null;
    const rendition = variants?.large ?? variants?.medium;
    return {
      id: m.id,
      name: m.name.slice(0, 120),
      src: mediaUrl(rendition?.path ?? m.path),
      alt: m.alt ?? "",
      width: rendition?.width ?? m.width,
      height: rendition?.height ?? m.height,
    };
  });
}

async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  let size = 0;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 70_000) {
        await reader.cancel();
        throw new Error("Request is too large.");
      }
      raw += decoder.decode(next.value, { stream: true });
    }
    const body: unknown = JSON.parse(raw + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid request.");
    return body as Record<string, unknown>;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const user = await assertAdmin();
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "Cross-site requests are not allowed." }, 403);
    const origin = request.headers.get("origin");
    const expectedHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    if (origin && new URL(origin).host !== expectedHost)
      return json({ error: "Invalid request origin." }, 403);
    let body: Record<string, unknown>;
    try {
      body = await boundedBody(request);
    } catch {
      return json({ error: "Invalid or oversized request." }, 400);
    }
    const { server, client } = await loadAiSettingsForAction();
    if (!client.is_ready)
      return json(
        { error: "Enable and configure your model in Settings → AI first." },
        400,
      );
    if (body.action === "validate") {
      if (typeof body.raw !== "string")
        return json({ error: "Missing model output." }, 400);
      try {
        const [media, products] = await Promise.all([
          availableMedia(),
          getProducts({ limit: 12 }),
        ]);
        const blocks = validateAiDesign(body.raw, media, products);
        return json({
          blocks,
          html: sanitizePageHtml(designPreviewHtml(blocks)),
          model: server.primary_model,
        });
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Invalid design." },
          422,
        );
      }
    }
    if (body.action !== "generate")
      return json({ error: "Unsupported action." }, 400);
    if (
      typeof body.prompt !== "string" ||
      !body.prompt.trim() ||
      body.prompt.length > 3000 ||
      (body.title !== undefined &&
        (typeof body.title !== "string" || body.title.length > 200))
    )
      return json({ error: "Describe the page in 1–3,000 characters." }, 400);
    if (!allowGeneration(user.id))
      return json(
        { error: "Please wait 15 seconds between generation requests." },
        429,
      );
    const [media, products] = await Promise.all([
      availableMedia(),
      getProducts({ limit: 12 }),
    ]);
    let maxTokens =
      server.token_budget_mode === "economy"
        ? 1400
        : server.token_budget_mode === "standard"
          ? 2800
          : 4000;
    const userPrompt = JSON.stringify({
      pageTitle: body.title ?? "",
      request: body.prompt,
      availableImages: media.map((m) => ({
        mediaId: m.id,
        name: m.name,
        alt: m.alt.slice(0, 300),
      })),
      availableProducts: products
        .filter((p) => (p.type ?? "simple") === "simple")
        .map((p) => ({ productId: p.id, name: p.name.slice(0, 160) })),
    });
    if (server.provider === "ollama") {
      // Approximate conservatively; tokenization varies by model and language.
      const estimatedInput = Math.ceil(
        new TextEncoder().encode(
          AI_DESIGN_SYSTEM_PROMPT + userPrompt + server.brand_tone,
        ).length / 3,
      );
      const outputRoom = server.ollama_num_ctx - estimatedInput - 512;
      if (outputRoom < 600)
        return json(
          {
            error:
              "This design prompt is too large for the configured Ollama context. Shorten it or increase context length in Settings → AI (at least 4096 is recommended).",
          },
          422,
        );
      maxTokens = Math.min(maxTokens, outputRoom);
    }
    const systemPrompt = `${AI_DESIGN_SYSTEM_PROMPT}\nBrand tone: ${server.brand_tone.slice(0, 300)}. Language: ${server.default_language}. Output budget: ${maxTokens} tokens; ${maxTokens < 2000 ? "generate just 1–2 short sections" : "prefer 2–4 sections"}. Finish valid JSON within that budget.`;
    if (server.provider === "ollama" && server.ollama_mode === "browser") {
      // Only a public transport configuration leaves the server. No stored bearer keys.
      return json({
        transport: "browser",
        baseUrl: server.ollama_base_url
          .replace(/\/+$/, "")
          .replace(/\/v1$/, ""),
        model: server.primary_model,
        systemPrompt,
        userPrompt,
        maxTokens,
        numCtx: server.ollama_num_ctx,
        disableThinking: server.ollama_disable_thinking,
      });
    }
    let raw: string;
    let model: string;
    try {
      const completion = await runModelCompletion({
        settings: server,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [],
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(150_000)]),
        maxOutputTokens: maxTokens,
      });
      raw = completion.text;
      model = completion.modelUsed;
    } catch {
      return json(
        {
          error: `Could not complete generation with ${AI_PROVIDERS[server.provider].label}. Check Settings → AI, provider quota and connectivity, or try fewer sections. No page changes were made.`,
        },
        502,
      );
    }
    try {
      const blocks = validateAiDesign(raw, media, products);
      return json({
        blocks,
        html: sanitizePageHtml(designPreviewHtml(blocks)),
        model,
      });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Invalid design." },
        422,
      );
    }
  } catch (error) {
    if (error instanceof AdminAuthError)
      return json({ error: error.message }, 403);
    return json(
      {
        error:
          "Page generation is unavailable. Check AI settings and try again. Your editor has not changed.",
      },
      500,
    );
  }
}
