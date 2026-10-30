"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CloudIcon,
  CpuIcon,
  PackageIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { runBrowserOllamaAgentTurn } from "@/lib/ai/ollama-browser";
import type {
  AiActionPlan,
  AiAgentTurnResponse,
  AiChatHistoryItem,
  AiToolBadge,
} from "@/lib/ai/types";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useNemesisAi } from "./ai-context";

type ChatEntry =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      toolBadges: AiToolBadge[];
      plans: AiActionPlan[];
      modelUsed: string;
      usedFallback: boolean;
      tokensUsed: number;
    };

const QUICK_PROMPTS = [
  {
    label: "10% off category",
    prompt: "Add a 10% discount on products in our main category and flag any with less than 3 in stock",
  },
  {
    label: "Draft out-of-stock",
    prompt: "Put all out-of-stock products into draft and list any active products with 3 or fewer in stock",
  },
  {
    label: "Weekly sales summary",
    prompt: "Summarize the last 7 days of revenue, top-selling products, and pending orders",
  },
  {
    label: "Audit & fix SEO",
    prompt: "Audit my store's SEO and generate fixes for any products, blog posts, or pages missing descriptions or alt text",
  },
];

export function NemesisAiDrawer() {
  const router = useRouter();
  const { open, setOpen, promptInput: input, setPromptInput: setInput, aiSettings } = useNemesisAi();

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [rateInfo, setRateInfo] = useState<{
    limit?: number | null;
    remaining?: number | null;
    sessionTokens: number;
  }>({ sessionTokens: 0 });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const msgSeqRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, running]);

  const providerMeta = AI_PROVIDERS[aiSettings.provider];
  const isBrowserOllama =
    aiSettings.provider === "ollama" && aiSettings.ollama_mode === "browser";

  async function submitPrompt(rawText?: string) {
    const prompt = (rawText ?? input).trim();
    if (!prompt || running) return;

    if (!aiSettings.enabled) {
      toast.error("Enable Nemesis AI in Settings → AI first.");
      return;
    }

    msgSeqRef.current += 1;
    const userEntry: ChatEntry = {
      id: `u_${msgSeqRef.current}`,
      role: "user",
      content: prompt,
    };

    const history: AiChatHistoryItem[] = entries.map((e) => ({
      role: e.role,
      content: e.content,
    }));

    setEntries((prev) => [...prev, userEntry]);
    setInput("");
    setRunning(true);

    try {
      let data: AiAgentTurnResponse;
      if (isBrowserOllama) {
        data = await runBrowserOllamaAgentTurn({ prompt, history });
      } else {
        const res = await fetch("/api/nemesis/ai/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "run", prompt, history }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: string;
          data?: AiAgentTurnResponse;
        };
        if (!json.ok || !json.data) {
          throw new Error(json.error || "Nemesis AI request failed.");
        }
        data = json.data;
      }

      setRateInfo((prev) => ({
        limit: data.rateLimit.limitTokensPerMin ?? prev.limit,
        remaining: data.rateLimit.remainingTokensPerMin ?? prev.remaining,
        sessionTokens: prev.sessionTokens + (data.rateLimit.usedTokensThisTurn || 0),
      }));

      msgSeqRef.current += 1;
      const assistantEntry: ChatEntry = {
        id: `a_${msgSeqRef.current}`,
        role: "assistant",
        content: data.reply,
        toolBadges: data.toolBadges,
        plans: data.plans,
        modelUsed: data.modelUsed,
        usedFallback: data.usedFallback,
        tokensUsed: data.rateLimit.usedTokensThisTurn,
      };
      setEntries((prev) => [...prev, assistantEntry]);

      if (!aiSettings.require_confirmation) {
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to run AI agent.";
      toast.error(msg);
      msgSeqRef.current += 1;
      const errId = `err_${msgSeqRef.current}`;
      setEntries((prev) => [
        ...prev,
        {
          id: errId,
          role: "assistant",
          content: `⚠️ ${msg}`,
          toolBadges: [],
          plans: [],
          modelUsed: aiSettings.primary_model,
          usedFallback: false,
          tokensUsed: 0,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  const usedInMinute =
    rateInfo.limit != null && rateInfo.remaining != null
      ? Math.max(0, rateInfo.limit - rateInfo.remaining)
      : null;

  return (
    <SheetContent
      isOpen={open}
      onOpenChange={setOpen}
      side="right"
      className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl"
    >
      {/* Top Header */}
      <SheetHeader className="border-b bg-background/95 px-5 py-4 pr-12">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <SparklesIcon className="size-4" />
            </span>
            <div>
              <SheetTitle className="text-base font-semibold leading-tight">
                Nemesis AI Agent
              </SheetTitle>
              <SheetDescription className="text-xs">
                Multi-step catalog, order &amp; SEO copilot
              </SheetDescription>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear conversation"
                onPress={() => setEntries([])}
              >
                <RotateCcwIcon className="size-3.5" />
              </Button>
            )}
            <LinkButton
              href="/nemesis/settings?tab=ai"
              variant="ghost"
              size="icon-sm"
              aria-label="AI Settings"
              onPress={() => setOpen(false)}
            >
              <SettingsIcon className="size-3.5" />
            </LinkButton>
          </div>
        </div>

        {/* Provider + Token Meter Strip */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary" className="gap-1.5 font-normal">
            {isBrowserOllama ? (
              <CpuIcon className="size-3 text-primary" />
            ) : (
              <CloudIcon className="size-3 text-primary" />
            )}
            <span className="truncate max-w-[240px]">
              {providerMeta.label} · {aiSettings.primary_model || "No model"}
            </span>
          </Badge>

          <Badge
            variant="outline"
            className="gap-1.5 border-primary/30 bg-primary/[0.04] font-mono text-[11px] tabular-nums"
          >
            {usedInMinute !== null && rateInfo.limit ? (
              <span>
                {usedInMinute.toLocaleString()} / {rateInfo.limit.toLocaleString()} TPM
              </span>
            ) : aiSettings.provider === "groq" && aiSettings.token_budget_mode === "economy" ? (
              <span>{rateInfo.sessionTokens.toLocaleString()} tok · 8k TPM Safe</span>
            ) : (
              <span>{rateInfo.sessionTokens.toLocaleString()} tokens used</span>
            )}
          </Badge>
        </div>
      </SheetHeader>

      {/* Scrollable Thread Body */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        data-testid="nemesis-ai-thread"
      >
        {!aiSettings.is_ready && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-4 text-sm">
            <p className="font-semibold text-foreground">
              {!aiSettings.enabled
                ? "Nemesis AI is currently turned off"
                : `Add your ${providerMeta.label} API key to start`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure Groq (GPT OSS 120B/20B), OpenAI, Claude, Gemini, OpenRouter, or local
              Ollama (Qwen3.5 9B) in Settings → AI.
            </p>
            <div className="mt-3">
              <LinkButton
                href="/nemesis/settings?tab=ai"
                size="sm"
                onPress={() => setOpen(false)}
              >
                <SettingsIcon className="size-3.5" /> Configure AI Settings
              </LinkButton>
            </div>
          </div>
        )}

        {entries.length === 0 && aiSettings.is_ready && (
          <div className="rounded-2xl border border-dashed bg-muted/30 p-5 text-center">
            <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <SparklesIcon className="size-5" />
            </span>
            <p className="mt-3 font-semibold text-foreground">What should we run on your store?</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Ask me to apply category discounts, draft out-of-stock items, summarize sales &amp;
              pending orders, or audit &amp; fix store SEO. Database changes always show a preview
              card before saving.
            </p>
          </div>
        )}

        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-xs">
                {entry.content}
              </div>
            </div>
          ) : (
            <div key={entry.id} className="space-y-3">
              {/* Completed Tool-Call Pills */}
              {entry.toolBadges.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.toolBadges.map((b) => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground"
                    >
                      <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
                      {b.summary}
                    </span>
                  ))}
                </div>
              )}

              {/* Assistant Message */}
              {entry.content && (
                <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-2xs">
                  {entry.content}
                  {entry.usedFallback && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Routed via fallback worker model ({entry.modelUsed})
                    </p>
                  )}
                </div>
              )}

              {/* Confirmation Preview Cards */}
              {entry.plans.map((plan) => (
                <ActionPlanPreviewCard
                  key={plan.id}
                  plan={plan}
                  onApplied={() => router.refresh()}
                />
              ))}
            </div>
          ),
        )}

        {running && (
          <div className="flex items-center gap-2.5 rounded-xl border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <Spinner className="size-4 text-primary" />
            <span>
              {isBrowserOllama
                ? `Running local Ollama (${aiSettings.primary_model})…`
                : `Thinking & executing store tools (${aiSettings.primary_model})…`}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Quick Chips + Prompt Bar */}
      <div className="border-t bg-background p-4">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={running}
              onClick={() => submitPrompt(chip.prompt)}
              className="cursor-pointer rounded-full border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.06] hover:text-foreground disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitPrompt();
              }
            }}
            rows={2}
            placeholder="Ask Nemesis AI (e.g. Add a 10% discount on Mobile category products)…"
            className="min-h-[52px] resize-none text-sm"
            disabled={running}
          />
          <Button
            type="submit"
            size="icon"
            isDisabled={running || !input.trim()}
            isPending={running}
            aria-label="Send prompt"
            className="size-11 shrink-0 rounded-xl"
          >
            {running ? <Spinner /> : <ArrowRightIcon className="size-4" />}
          </Button>
        </form>
      </div>
    </SheetContent>
  );
}

/* ── Interactive Confirmation Preview Card ("Apply All") ─────────────────── */

function ActionPlanPreviewCard({
  plan,
  onApplied,
}: {
  plan: AiActionPlan;
  onApplied: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(plan.items.map((i) => i.id)),
  );
  const [status, setStatus] = useState<"pending" | "applying" | "applied" | "cancelled">(
    "pending",
  );
  const [appliedCount, setAppliedCount] = useState(0);

  function toggleItem(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(plan.items.map((i) => i.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  async function handleApply() {
    if (selectedIds.size === 0 || status !== "pending") return;
    setStatus("applying");
    try {
      const res = await fetch("/api/nemesis/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "apply_plan",
          plan,
          selectedItemIds: [...selectedIds],
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        appliedCount?: number;
        errors?: string[];
      };
      if (!json.ok) {
        throw new Error(json.error || "Failed to apply changes.");
      }
      const count = json.appliedCount ?? 0;
      setAppliedCount(count);
      setStatus("applied");
      toast.success(`Applied ${count} ${count === 1 ? "change" : "changes"} to your store.`);
      if (json.errors && json.errors.length > 0) {
        toast.warning(json.errors[0]);
      }
      onApplied();
    } catch (err) {
      setStatus("pending");
      toast.error(err instanceof Error ? err.message : "Could not apply plan.");
    }
  }

  const allChecked = selectedIds.size === plan.items.length && plan.items.length > 0;
  const someChecked = selectedIds.size > 0 && !allChecked;

  return (
    <div
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
      data-testid="ai-confirmation-preview"
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-2.5">
          {status === "pending" && (
            <Checkbox
              aria-label="Select all items"
              isSelected={allChecked}
              isIndeterminate={someChecked}
              onChange={toggleAll}
              className="mt-0.5"
            />
          )}
          <div>
            <p className="text-xs font-semibold text-foreground">
              Confirmation Preview — {plan.title}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{plan.description}</p>
          </div>
        </div>
      </div>

      {/* Item Rows */}
      <div className="max-h-72 divide-y overflow-y-auto">
        {plan.items.map((item) => {
          const checked = selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5 text-xs transition-colors",
                !checked && status === "pending" && "opacity-50",
              )}
            >
              {status === "pending" && (
                <Checkbox
                  aria-label={`Select ${item.title}`}
                  isSelected={checked}
                  onChange={(val) => toggleItem(item.id, val)}
                  className="mt-1"
                />
              )}

              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-9 shrink-0 rounded-lg border bg-muted object-cover"
                />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <PackageIcon className="size-4" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{item.title}</span>
                  <div className="flex items-center gap-1.5 tabular-nums">
                    {item.oldValueLabel && (
                      <>
                        <span className="text-muted-foreground line-through">
                          {item.oldValueLabel}
                        </span>
                        <span className="text-muted-foreground">→</span>
                      </>
                    )}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {item.newValueLabel}
                    </span>
                  </div>
                </div>

                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                  {item.subtitle && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {item.subtitle}
                    </span>
                  )}
                  {item.stockBadge && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        item.stockBadge.tone === "emerald" &&
                          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                        item.stockBadge.tone === "amber" &&
                          "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        item.stockBadge.tone === "rose" &&
                          "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                        item.stockBadge.tone === "neutral" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {item.stockBadge.label}
                    </span>
                  )}
                </div>

                {item.detailText && (
                  <p className="mt-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground">
                    {item.detailText}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2.5">
        {status === "applied" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4" />
            Applied {appliedCount} {appliedCount === 1 ? "change" : "changes"} (0 extra AI tokens)
          </span>
        ) : status === "cancelled" ? (
          <span className="text-xs text-muted-foreground">Preview dismissed — no changes made.</span>
        ) : (
          <>
            <span className="text-[11px] text-muted-foreground">
              No database changes saved yet
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                isDisabled={status === "applying"}
                onPress={() => setStatus("cancelled")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                isDisabled={selectedIds.size === 0 || status === "applying"}
                isPending={status === "applying"}
                onPress={() => void handleApply()}
              >
                {status === "applying" && <Spinner />}
                {status === "applying"
                  ? "Applying…"
                  : `Apply All (${selectedIds.size})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
