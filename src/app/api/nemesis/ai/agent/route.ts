import { NextResponse } from "next/server";
import { AdminAuthError } from "@/lib/admin/auth";
import {
  runModelCompletion,
  type AiToolCall,
  type AiTurnMessage,
} from "@/lib/ai/client";
import { CONTENT_PREVIEW_REPAIR, needsContentPreviewRepair } from "@/lib/ai/content-fields";
import { loadAiSettingsForAction } from "@/lib/ai/settings";
import {
  AGENT_TOOLS,
  buildAgentSystemPrompt,
  executeAgentToolCall,
  executeApprovedPlan,
  loadStoreContextSummary,
} from "@/lib/ai/tools";
import { planRequiresApproval } from "@/lib/ai/types";
import type {
  AiActionPlan,
  AiAgentTurnResponse,
  AiChatHistoryItem,
  AiToolBadge,
  AiUiWidget,
} from "@/lib/ai/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { server: aiSettings } = await loadAiSettingsForAction();
    const body = (await request.json()) as
      | {
          phase: "run";
          prompt: string;
          currentPath?: string;
          history?: AiChatHistoryItem[];
        }
      | {
          phase: "ollama_prepare";
          currentPath?: string;
        }
      | {
          phase: "ollama_execute_tools";
          toolCalls: AiToolCall[];
        }
      | {
          phase: "apply_plan";
          plan: AiActionPlan;
          selectedItemIds: string[];
        };

    /* Phase A: Zero-token execution of an admin-approved Confirmation Preview Card */
    if (body.phase === "apply_plan") {
      if (!body.plan || !Array.isArray(body.selectedItemIds)) {
        return NextResponse.json({ ok: false, error: "Invalid action plan payload." }, { status: 400 });
      }
      const res = await executeApprovedPlan({
        plan: body.plan,
        selectedItemIds: body.selectedItemIds,
      });
      return NextResponse.json({ ok: true, ...res });
    }

    if (!aiSettings.enabled) {
      return NextResponse.json(
        {
          ok: false,
          error: "Nemesis AI is currently disabled. Enable it in Settings → AI first.",
        },
        { status: 400 },
      );
    }

    /* Phase B: Browser-Direct Local Ollama Step 1 — prepare context & tool schemas */
    if (body.phase === "ollama_prepare") {
      const { context } = await loadStoreContextSummary();
      const systemPrompt = buildAgentSystemPrompt(aiSettings, context, body.currentPath);
      return NextResponse.json({
        ok: true,
        systemPrompt,
        tools: AGENT_TOOLS,
        ollamaBaseUrl: aiSettings.ollama_base_url,
        model: aiSettings.primary_model,
        numCtx: aiSettings.ollama_num_ctx,
        disableThinking: aiSettings.ollama_disable_thinking,
        requireConfirmation: aiSettings.require_confirmation,
      });
    }

    /* Phase C: Browser-Direct Local Ollama Step 2 — execute tool calls securely on server */
    if (body.phase === "ollama_execute_tools") {
      const { context, money } = await loadStoreContextSummary();
      const toolResults: Array<{ toolCallId: string; name: string; content: string }> = [];
      const badges: AiToolBadge[] = [];
      const plans: AiActionPlan[] = [];
      const widgets: AiUiWidget[] = [];

      for (const tc of body.toolCalls ?? []) {
        const out = await executeAgentToolCall({
          call: tc,
          aiSettings,
          store: context,
          money,
          allowModelSubcall: false,
        });
        toolResults.push({
          toolCallId: tc.id,
          name: tc.name,
          content: out.toolOutputJson,
        });
        badges.push(out.badge);
        if (out.plan) plans.push(out.plan);
        if (out.widget) widgets.push(out.widget);
      }

      if (!aiSettings.require_confirmation && plans.length > 0) {
        for (const p of plans.filter((p) => !planRequiresApproval(p))) {
          await executeApprovedPlan({
            plan: p,
            selectedItemIds: p.items.map((i) => i.id),
          });
        }
        const pendingApproval = plans.filter(planRequiresApproval);
        plans.splice(0, plans.length, ...pendingApproval);
      }

      return NextResponse.json({
        ok: true,
        toolResults,
        badges,
        plans,
        widgets,
      });
    }

    /* Phase D: Full Server-Side Multi-Step Agent Loop (Groq, OpenAI, Claude, Gemini, OpenRouter, DeepSeek, Ollama Tunnel, Custom) */
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Please enter a prompt." }, { status: 400 });
    }

    const { context, money } = await loadStoreContextSummary();
    const systemPrompt = buildAgentSystemPrompt(aiSettings, context, body.currentPath);

    const historyLimit =
      aiSettings.token_budget_mode === "economy"
        ? 4
        : aiSettings.token_budget_mode === "standard"
          ? 10
          : 24;

    const messages: AiTurnMessage[] = (body.history ?? [])
      .slice(-historyLimit)
      .filter((h) => h.content && (h.role === "user" || h.role === "assistant"))
      .map((h) => ({
        role: h.role,
        content:
          aiSettings.token_budget_mode === "economy"
            ? h.content.slice(0, 600)
            : h.content.slice(0, 2500),
      }));

    messages.push({ role: "user", content: prompt.slice(0, 4000) });

    const maxRounds =
      aiSettings.token_budget_mode === "economy"
        ? 2
        : aiSettings.token_budget_mode === "standard"
          ? 4
          : 6;

    const toolBadges: AiToolBadge[] = [];
    const plans: AiActionPlan[] = [];
    const widgets: AiUiWidget[] = [];
    let totalTokensUsed = 0;
    let lastModelUsed = aiSettings.primary_model;
    let anyFallback = false;
    let limitTokensPerMin: number | null | undefined = null;
    let remainingTokensPerMin: number | null | undefined = null;
    let finalReply = "";
    let repairedContentPreview = false;

    for (let round = 0; round <= maxRounds; round++) {
      const isLastAllowedRound = round === maxRounds;
      const completion = await runModelCompletion({
        settings: aiSettings,
        systemPrompt,
        messages,
        tools: isLastAllowedRound ? [] : AGENT_TOOLS,
      });

      totalTokensUsed += completion.usage.totalTokens;
      lastModelUsed = completion.modelUsed;
      if (completion.usedFallback) anyFallback = true;
      if (completion.rateLimit.limitTokensPerMin != null) {
        limitTokensPerMin = completion.rateLimit.limitTokensPerMin;
      }
      if (completion.rateLimit.remainingTokensPerMin != null) {
        remainingTokensPerMin = completion.rateLimit.remainingTokensPerMin;
      }

      if (completion.toolCalls.length === 0 && !isLastAllowedRound && plans.length === 0 && !repairedContentPreview && needsContentPreviewRepair(prompt, completion.text)) {
        repairedContentPreview = true;
        messages.push({ role: "assistant", content: completion.text });
        messages.push({ role: "user", content: CONTENT_PREVIEW_REPAIR });
        round--; // Preserve the normal read -> preview -> summary tool budget; retry only once.
        continue;
      }

      if (completion.toolCalls.length === 0 || isLastAllowedRound) {
        finalReply = completion.text;
        break;
      }

      messages.push({
        role: "assistant",
        content: completion.text,
        toolCalls: completion.toolCalls,
      });

      for (const tc of completion.toolCalls) {
        const exec = await executeAgentToolCall({
          call: tc,
          aiSettings,
          store: context,
          money,
          allowModelSubcall: true,
        });
        toolBadges.push(exec.badge);
        if (exec.plan) plans.push(exec.plan);
        if (exec.widget) widgets.push(exec.widget);
        messages.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.name,
          content: exec.toolOutputJson,
        });
      }
    }

    let autoAppliedTotal = 0;
    if (!aiSettings.require_confirmation && plans.length > 0) {
      for (const p of plans.filter((p) => !planRequiresApproval(p))) {
        const applied = await executeApprovedPlan({
          plan: p,
          selectedItemIds: p.items.map((i) => i.id),
        });
        autoAppliedTotal += applied.appliedCount;
      }
      const pendingApproval = plans.filter(planRequiresApproval);
      plans.splice(0, plans.length, ...pendingApproval);
    }

    if (!finalReply) {
      finalReply =
        plans.length > 0
          ? "I've prepared a confirmation preview below. Review the matched items and click Apply All when ready."
          : autoAppliedTotal > 0
            ? `Done — automatically applied ${autoAppliedTotal} changes.`
            : "Task completed.";
    }

    const payload: AiAgentTurnResponse = {
      reply: finalReply,
      toolBadges,
      plans,
      widgets,
      provider: aiSettings.provider,
      modelUsed: lastModelUsed,
      usedFallback: anyFallback,
      rateLimit: {
        limitTokensPerMin,
        remainingTokensPerMin,
        usedTokensThisTurn: totalTokensUsed,
      },
    };

    return NextResponse.json({ ok: true, data: payload });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Nemesis AI agent failed.",
      },
      { status: 400 },
    );
  }
}
