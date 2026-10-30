"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  BarChart3Icon,
  BotIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CheckIcon,
  CpuIcon,
  FileTextIcon,
  PackageIcon,
  PercentIcon,
  PlusCircleIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  SettingsIcon,
  SparklesIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { runBrowserOllamaAgentTurn } from "@/lib/ai/ollama-browser";
import type {
  AiActionPlan,
  AiAgentTurnResponse,
  AiChatHistoryItem,
  AiToolBadge,
  AiUiWidget,
} from "@/lib/ai/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useNemesisAi } from "./ai-context";
import {
  AiWidgetCard,
  RichAiMessage,
  ToolOperationsAccordion,
} from "./ai-rich-message";

type ChatEntry =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      toolBadges: AiToolBadge[];
      plans: AiActionPlan[];
      widgets: AiUiWidget[];
      modelUsed: string;
      usedFallback: boolean;
      tokensUsed: number;
    };

type QuickPromptAction = {
  label: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
};

const STARTER_PROMPTS: QuickPromptAction[] = [
  {
    label: "Draft out-of-stock & check low stock",
    prompt:
      "Put all out-of-stock products into draft and list any active products with 3 or fewer in stock",
    icon: BoxesIcon,
  },
  {
    label: "10% off main category",
    prompt:
      "Add a 10% discount on products in our main category and flag any with less than 3 in stock",
    icon: PercentIcon,
  },
  {
    label: "Weekly sales summary",
    prompt: "Summarize the last 7 days of revenue, top-selling products, and pending orders",
    icon: BarChart3Icon,
  },
  {
    label: "Audit & fix store SEO",
    prompt:
      "Audit my store's SEO and generate fixes for any products, blog posts, or pages missing descriptions or alt text",
    icon: SearchCheckIcon,
  },
];

function getFollowUpActions(entry: Extract<ChatEntry, { role: "assistant" }>): QuickPromptAction[] {
  const toolNames = new Set(entry.toolBadges.map((b) => b.name));

  if (toolNames.has("preview_product_status_update") || toolNames.has("query_inventory")) {
    return [
      {
        label: "Restock out-of-stock items to 50",
        prompt: "Restock all out-of-stock products to 50 units",
        icon: PlusCircleIcon,
      },
      {
        label: "Audit SEO on catalog",
        prompt: "Audit my products for missing descriptions or image alt text and prepare fixes",
        icon: TagIcon,
      },
    ];
  }

  if (toolNames.has("preview_category_discount")) {
    return [
      {
        label: "Check low-stock active items",
        prompt: "List all active products with 3 or fewer in stock",
        icon: BoxesIcon,
      },
      {
        label: "Remove sale discounts",
        prompt: "Remove sale discounts on discounted products by setting discount to 0%",
        icon: TagIcon,
      },
    ];
  }

  if (toolNames.has("get_store_analytics")) {
    return [
      {
        label: "Flag low/zero stock items",
        prompt: "List any active products with 3 or fewer in stock",
        icon: BoxesIcon,
      },
      {
        label: "Audit & fix SEO",
        prompt:
          "Audit my store's SEO and generate fixes for any products, blog posts, or pages missing descriptions or alt text",
        icon: SearchCheckIcon,
      },
    ];
  }

  return [
    {
      label: "Weekly sales summary",
      prompt: "Summarize the last 7 days of revenue, top-selling products, and pending orders",
      icon: BarChart3Icon,
    },
    {
      label: "Check low-stock products",
      prompt: "List any active products with 3 or fewer in stock",
      icon: BoxesIcon,
    },
  ];
}

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
        widgets: data.widgets ?? [],
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
          widgets: [],
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

  const shortModel = (aiSettings.primary_model || "No model").replace(/^[^/]+\//, "");
  const lastAssistantId = [...entries].reverse().find((e) => e.role === "assistant")?.id;

  return (
    <SheetContent
      isOpen={open}
      onOpenChange={setOpen}
      side="right"
      showCloseButton={false}
      className="w-full gap-0 bg-background p-0 data-[side=right]:sm:max-w-2xl"
    >
      {/* Redesigned Top Header + Telemetry Bar */}
      <div className="border-b bg-muted/25 px-5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/25">
              <SparklesIcon className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SheetTitle className="truncate text-base font-bold tracking-tight">
                  Nemesis AI Agent
                </SheetTitle>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Copilot
                </span>
              </div>
              <SheetDescription className="truncate text-xs">
                Multi-step catalog, order &amp; SEO copilot
              </SheetDescription>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear conversation"
                onPress={() => setEntries([])}
              >
                <RotateCcwIcon className="size-4" />
              </Button>
            )}
            <LinkButton
              href="/nemesis/settings?tab=ai"
              variant="ghost"
              size="icon-sm"
              aria-label="AI Settings"
              onPress={() => setOpen(false)}
            >
              <SettingsIcon className="size-4" />
            </LinkButton>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close AI drawer"
              onPress={() => setOpen(false)}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>

        {/* Model & TPM Telemetry Pills */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background/85 px-3 py-1 text-xs">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                aiSettings.is_ready ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            <span className="text-muted-foreground">Model:</span>
            <span className="truncate font-mono font-medium text-foreground">
              {providerMeta.label} · {shortModel}
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/85 px-3 py-1 text-xs">
            <CpuIcon className="size-3.5 text-primary" />
            {usedInMinute !== null && rateInfo.limit ? (
              <>
                <span className="font-mono font-medium text-foreground">
                  {usedInMinute.toLocaleString()}
                </span>
                <span className="text-muted-foreground">
                  / {rateInfo.limit.toLocaleString()} TPM
                </span>
              </>
            ) : aiSettings.provider === "groq" && aiSettings.token_budget_mode === "economy" ? (
              <>
                <span className="font-mono font-medium text-foreground">
                  {rateInfo.sessionTokens.toLocaleString()}
                </span>
                <span className="text-muted-foreground">/ 8,000 TPM</span>
              </>
            ) : (
              <>
                <span className="font-mono font-medium text-foreground">
                  {rateInfo.sessionTokens.toLocaleString()}
                </span>
                <span className="text-muted-foreground">tokens</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Stream Container */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5"
        data-testid="nemesis-ai-thread"
      >
        {!aiSettings.is_ready && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-4 text-sm">
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
          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-5 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                <BotIcon className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-foreground">
                What should we run on your store?
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                Apply batch discounts, move out-of-stock products to draft, inspect low-stock
                inventory, review store analytics, or generate SEO fixes with interactive approval
                tables.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STARTER_PROMPTS.map((item) => {
                const ActionIcon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={running}
                    onClick={() => void submitPrompt(item.prompt)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl border bg-card p-3 text-left text-xs font-medium text-foreground shadow-2xs transition-colors hover:border-primary/40 hover:bg-muted/40 disabled:opacity-50"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ActionIcon className="size-3.5" />
                    </span>
                    <span className="line-clamp-2">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[86%] rounded-2xl rounded-tr-xs border border-primary/25 bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-xs">
                {entry.content}
              </div>
            </div>
          ) : (
            <div key={entry.id} className="flex items-start gap-3">
              {/* Bot Avatar */}
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/12 text-primary">
                <BotIcon className="size-4" />
              </div>

              <div className="min-w-0 flex-1 space-y-3.5">
                {/* 1. Accordion Tool Operations Log */}
                <ToolOperationsAccordion badges={entry.toolBadges} />

                {/* 2. Actionable Batch Update / Approval Cards */}
                {entry.plans.map((plan) => (
                  <ActionPlanPreviewCard
                    key={plan.id}
                    plan={plan}
                    onApplied={() => router.refresh()}
                  />
                ))}

                {/* 3. Structured Read-Tool Dashboard Widgets */}
                {entry.widgets.map((widget) => (
                  <AiWidgetCard key={widget.id} widget={widget} />
                ))}

                {/* 4. Rich Theme-Adaptive Message (Zero Raw Markdown) */}
                {entry.content && (
                  <RichAiMessage
                    content={entry.content}
                    hasStructuredCards={entry.plans.length > 0 || entry.widgets.length > 0}
                    usedFallback={entry.usedFallback}
                    modelUsed={entry.modelUsed}
                  />
                )}

                {/* 5. Contextual Follow-Up Quick Actions on Latest Turn */}
                {entry.id === lastAssistantId && !running && entry.toolBadges.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {getFollowUpActions(entry).map((act) => {
                      const ActIcon = act.icon;
                      return (
                        <button
                          key={act.label}
                          type="button"
                          onClick={() => void submitPrompt(act.prompt)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
                        >
                          <ActIcon className="size-3.5 text-muted-foreground" />
                          {act.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {running && (
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/12 text-primary">
              <BotIcon className="size-4" />
            </div>
            <div className="flex flex-1 items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground shadow-2xs">
              <Spinner className="size-4 text-primary" />
              <span>
                {isBrowserOllama
                  ? `Running local Ollama (${shortModel})…`
                  : `Executing store tools with ${shortModel}…`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Redesigned Bottom Input Bar */}
      <div className="border-t bg-muted/20 p-3.5 sm:p-4">
        {entries.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {STARTER_PROMPTS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={running}
                onClick={() => void submitPrompt(chip.prompt)}
                className="cursor-pointer rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
          className="relative flex items-end rounded-xl border bg-background shadow-2xs transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitPrompt();
              }
            }}
            rows={1}
            placeholder="Ask Nemesis to update prices, filter products, or edit status…"
            className="max-h-32 min-h-[46px] w-full resize-none bg-transparent py-3 pr-12 pl-4 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
            disabled={running}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <Button
              type="submit"
              size="icon-sm"
              isDisabled={running || !input.trim()}
              isPending={running}
              aria-label="Send prompt"
              className="rounded-lg"
            >
              {running ? <Spinner /> : <ArrowUpIcon className="size-4" />}
            </Button>
          </div>
        </form>
      </div>
    </SheetContent>
  );
}

/* ── Redesigned Actionable Batch Update Card (Structured Approval Table) ─── */

function StatusValueBadge({
  label,
  variant,
}: {
  label: string;
  variant: "current" | "target";
}) {
  const lower = label.toLowerCase();
  const isCurrency = /^[$৳€£]|\b(?:usd|bdt)\b/i.test(label.trim());

  if (variant === "current") {
    if (isCurrency) {
      return (
        <span className="font-mono text-[11px] text-muted-foreground line-through">{label}</span>
      );
    }
    if (lower === "active") {
      return (
        <span className="inline-flex rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          {label}
        </span>
      );
    }
    if (lower === "missing" || lower === "empty alt" || lower.startsWith("0 ")) {
      return (
        <span className="inline-flex rounded border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400">
          {label}
        </span>
      );
    }
    if (lower === "pending") {
      return (
        <span className="inline-flex rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium capitalize text-amber-700 dark:text-amber-300">
          {label}
        </span>
      );
    }
    return (
      <span className="inline-flex rounded border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
    );
  }

  if (lower.includes("draft") || lower === "unfeatured") {
    return (
      <span className="inline-flex rounded border bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
        {label}
      </span>
    );
  }
  if (lower === "cancelled") {
    return (
      <span className="inline-flex rounded border border-rose-500/25 bg-rose-500/12 px-2 py-0.5 text-[10px] font-semibold capitalize text-rose-700 dark:text-rose-400">
        {label}
      </span>
    );
  }
  if (lower === "processing") {
    return (
      <span className="inline-flex rounded border border-sky-500/25 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold capitalize text-sky-700 dark:text-sky-300">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded border border-emerald-500/25 bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
      {label}
    </span>
  );
}

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
      className={cn(
        "relative space-y-3.5 overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-xs",
        status === "applied"
          ? "border-emerald-500/35"
          : status === "cancelled"
            ? "border-border opacity-75"
            : "border-amber-500/30",
      )}
      data-testid="ai-confirmation-preview"
    >
      {/* Left Accent Bar */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          status === "applied"
            ? "bg-emerald-500"
            : status === "cancelled"
              ? "bg-muted-foreground/30"
              : "bg-amber-500",
        )}
      />

      {/* Card Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
              status === "applied"
                ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                : "border-amber-500/25 bg-amber-500/12 text-amber-600 dark:text-amber-400",
            )}
          >
            <FileTextIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{plan.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>
          </div>
        </div>

        {/* Top-Right Approval Action */}
        {status === "applied" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-3.5" />
            Applied ({appliedCount})
          </span>
        ) : status === "cancelled" ? (
          <span className="rounded-lg border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            Dismissed
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={status === "applying"}
              onClick={() => setStatus("cancelled")}
              className="cursor-pointer rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || status === "applying"}
              onClick={() => void handleApply()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-xs transition-all hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-50"
            >
              {status === "applying" ? (
                <Spinner className="size-3.5 text-slate-950" />
              ) : (
                <CheckIcon className="size-3.5 stroke-[2.5]" />
              )}
              {status === "applying"
                ? "Applying…"
                : selectedIds.size === plan.items.length
                  ? "Apply All Changes"
                  : `Apply (${selectedIds.size})`}
            </button>
          </div>
        )}
      </div>

      {/* Structured 12-Column Table of Changes */}
      <div className="overflow-hidden rounded-lg border bg-muted/15 text-xs">
        <div className="grid grid-cols-12 items-center border-b bg-muted/45 px-3 py-2 text-[11px] font-medium text-muted-foreground">
          <div className="col-span-6 flex items-center gap-2">
            {status === "pending" && (
              <Checkbox
                aria-label="Select all items"
                isSelected={allChecked}
                isIndeterminate={someChecked}
                onChange={toggleAll}
              />
            )}
            <span>Item / Product</span>
          </div>
          <div className="col-span-3">Current</div>
          <div className="col-span-3">Target</div>
        </div>

        <div className="max-h-72 divide-y divide-border/60 overflow-y-auto bg-background/60">
          {plan.items.map((item) => {
            const checked = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={cn(
                  "px-3 py-2.5 transition-opacity",
                  !checked && status === "pending" && "opacity-50",
                )}
              >
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-6 flex min-w-0 items-center gap-2">
                    {status === "pending" && (
                      <Checkbox
                        aria-label={`Select ${item.title}`}
                        isSelected={checked}
                        onChange={(val) => toggleItem(item.id, val)}
                      />
                    )}
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="size-7 shrink-0 rounded-md border bg-muted object-cover"
                      />
                    ) : (
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                        <PackageIcon className="size-3.5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{item.title}</div>
                      {item.subtitle && (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="col-span-3">
                    {item.oldValueLabel ? (
                      <StatusValueBadge label={item.oldValueLabel} variant="current" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="col-span-3 flex items-center gap-1.5">
                    <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
                    <StatusValueBadge label={item.newValueLabel} variant="target" />
                  </div>
                </div>

                {item.detailText && (
                  <p className="mt-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/90">
                    {item.detailText}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
