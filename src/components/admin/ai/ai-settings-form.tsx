"use client";

import { useEffect, useState, useTransition, type ComponentType } from "react";
import {
  AlertCircleIcon,
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CheckIcon,
  CloudIcon,
  CompassIcon,
  CpuIcon,
  ExternalLinkIcon,
  EyeIcon,
  GaugeIcon,
  GitBranchIcon,
  GlobeIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LaptopIcon,
  LayersIcon,
  LeafIcon,
  Link2Icon,
  MegaphoneIcon,
  MessageSquareCodeIcon,
  MonitorIcon,
  NetworkIcon,
  PenToolIcon,
  RefreshCwIcon,
  RocketIcon,
  SaveIcon,
  ScaleIcon,
  ScrollTextIcon,
  ServerCogIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  ThermometerIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { saveAiSettingsAction } from "@/app/nemesis/ai-actions";
import {
  listBrowserOllamaModels,
  testBrowserOllamaConnection,
} from "@/lib/ai/ollama-browser";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  type AiProviderId,
  type AiReasoningEffort,
  type AiTokenBudgetMode,
  type OllamaMode,
  type PublicAiSettings,
} from "@/lib/ai/providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useNemesisAi } from "./ai-context";

const PROVIDER_ICONS: Record<AiProviderId, ComponentType<{ className?: string }>> = {
  groq: ZapIcon,
  openai: BrainCircuitIcon,
  anthropic: MessageSquareCodeIcon,
  gemini: SparklesIcon,
  openrouter: NetworkIcon,
  deepseek: CompassIcon,
  ollama: LaptopIcon,
  custom: ServerCogIcon,
};

const BUDGET_OPTIONS: ReadonlyArray<{
  id: AiTokenBudgetMode;
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  iconTone: string;
}> = [
  {
    id: "economy",
    title: "Economy (8k TPM Safe)",
    desc: "Compact payloads & short history — ideal for free Groq / free tiers.",
    icon: LeafIcon,
    iconTone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "standard",
    title: "Standard",
    desc: "Balanced context window (up to 4 tool steps & 30 rows per query).",
    icon: ScaleIcon,
    iconTone: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  {
    id: "high",
    title: "High-Context (Paid API)",
    desc: "Full catalog slices & up to 6 chained agent steps for paid keys.",
    icon: RocketIcon,
    iconTone: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
];

export function AiSettingsForm({
  initialSettings,
  migrated,
  formId,
  onPendingChange,
}: {
  initialSettings: PublicAiSettings;
  migrated: boolean;
  /** When supplied by SettingsTabs, submission is triggered from the sticky top-right bar. */
  formId?: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { setAiSettings, openWithPrompt } = useNemesisAi();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    onPendingChange?.(saving);
  }, [saving, onPendingChange]);

  const [settings, setLocalSettings] = useState<PublicAiSettings>(initialSettings);
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [provider, setProvider] = useState<AiProviderId>(initialSettings.provider);
  const [primaryModel, setPrimaryModel] = useState(initialSettings.primary_model);
  const [fallbackModel, setFallbackModel] = useState(initialSettings.fallback_model ?? "");
  const [customBaseUrl, setCustomBaseUrl] = useState(initialSettings.custom_base_url ?? "");
  const [ollamaMode, setOllamaMode] = useState<OllamaMode>(initialSettings.ollama_mode);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(initialSettings.ollama_base_url);
  const [ollamaNumCtx, setOllamaNumCtx] = useState(String(initialSettings.ollama_num_ctx));
  const [ollamaDisableThinking, setOllamaDisableThinking] = useState(
    initialSettings.ollama_disable_thinking,
  );
  const [budgetMode, setBudgetMode] = useState<AiTokenBudgetMode>(
    initialSettings.token_budget_mode,
  );
  const [reasoningEffort, setReasoningEffort] = useState<AiReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [temperature, setTemperature] = useState(String(initialSettings.temperature));
  const [visionEnabled, setVisionEnabled] = useState(initialSettings.vision_enabled);
  const [requireConfirmation, setRequireConfirmation] = useState(
    initialSettings.require_confirmation,
  );
  const [brandTone, setBrandTone] = useState(initialSettings.brand_tone);
  const [defaultLanguage, setDefaultLanguage] = useState(initialSettings.default_language);
  const [systemInstructions, setSystemInstructions] = useState(
    initialSettings.system_instructions ?? "",
  );

  // Per-provider newly typed keys or explicit clear flags
  const [draftKeys, setDraftKeys] = useState<Partial<Record<AiProviderId, string>>>({});
  const [clearedKeys, setClearedKeys] = useState<Partial<Record<AiProviderId, boolean>>>({});

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const meta = AI_PROVIDERS[provider];
  const typedKey = draftKeys[provider] ?? "";
  const isCleared = Boolean(clearedKeys[provider]);
  const storedMask = !isCleared ? settings.masked_keys[provider] : null;
  const usingEnvKey = !isCleared && settings.env_keys[provider];

  function handleSelectProvider(next: AiProviderId) {
    setProvider(next);
    setFetchedModels([]);
    setTestResult(null);
    const nextMeta = AI_PROVIDERS[next];
    if (nextMeta.defaultPrimaryModel) setPrimaryModel(nextMeta.defaultPrimaryModel);
    setFallbackModel(nextMeta.defaultFallbackModel ?? "");
    setBudgetMode(nextMeta.defaultBudgetMode);
  }

  async function handleFetchModels() {
    setLoadingModels(true);
    setTestResult(null);
    try {
      if (provider === "ollama" && ollamaMode === "browser") {
        const list = await listBrowserOllamaModels(ollamaBaseUrl);
        setFetchedModels(list);
        if (list.length > 0 && !primaryModel) setPrimaryModel(list[0]);
        toast.success(`Detected ${list.length} local Ollama ${list.length === 1 ? "model" : "models"}.`);
      } else {
        const res = await fetch("/api/nemesis/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "list_models",
            provider,
            apiKey: typedKey.trim() || null,
            baseUrl:
              provider === "ollama"
                ? ollamaBaseUrl
                : provider === "custom"
                  ? customBaseUrl
                  : customBaseUrl || null,
          }),
        });
        const json = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
        if (!json.ok) throw new Error(json.error || "Could not load models.");
        const list = json.models ?? [];
        setFetchedModels(list);
        toast.success(`Loaded ${list.length} available models from ${meta.label}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load models.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      if (provider === "ollama" && ollamaMode === "browser") {
        const res = await testBrowserOllamaConnection({
          baseUrl: ollamaBaseUrl,
          model: primaryModel || "qwen3.5:9b",
          numCtx: Number.parseInt(ollamaNumCtx, 10) || 4096,
          disableThinking: ollamaDisableThinking,
        });
        const msg = `Connected to local Ollama (${res.modelUsed}) in ${res.latencyMs}ms${res.toolCallingVerified ? " · Tool-calling verified ✓" : ""}`;
        setTestResult({ ok: true, message: msg });
        toast.success(msg);
      } else {
        const res = await fetch("/api/nemesis/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test_connection",
            provider,
            model: primaryModel,
            apiKey: typedKey.trim() || null,
            baseUrl:
              provider === "ollama"
                ? ollamaBaseUrl
                : provider === "custom"
                  ? customBaseUrl
                  : customBaseUrl || null,
          }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: string;
          latencyMs?: number;
          modelUsed?: string;
          toolCallingVerified?: boolean;
        };
        if (!json.ok) throw new Error(json.error || "Connection test failed.");
        const msg = `Connected to ${json.modelUsed} in ${json.latencyMs}ms${json.toolCallingVerified ? " · Tool-calling verified ✓" : ""}`;
        setTestResult({ ok: true, message: msg });
        toast.success(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection test failed.";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const keyChanges: Partial<Record<AiProviderId, string | null>> = {};
      for (const id of AI_PROVIDER_IDS) {
        if (clearedKeys[id]) {
          keyChanges[id] = null;
        }
        const draft = draftKeys[id]?.trim();
        if (draft) {
          keyChanges[id] = draft;
        }
      }

      const result = await saveAiSettingsAction({
        enabled,
        provider,
        primary_model: primaryModel,
        fallback_model: fallbackModel || null,
        custom_base_url: customBaseUrl || null,
        ollama_mode: ollamaMode,
        ollama_base_url: ollamaBaseUrl,
        ollama_num_ctx: Number.parseInt(ollamaNumCtx, 10) || 4096,
        ollama_disable_thinking: ollamaDisableThinking,
        token_budget_mode: budgetMode,
        reasoning_effort: reasoningEffort,
        temperature: Number.parseFloat(temperature) || 0.2,
        vision_enabled: visionEnabled,
        require_confirmation: requireConfirmation,
        brand_tone: brandTone,
        default_language: defaultLanguage,
        system_instructions: systemInstructions || null,
        keyChanges,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setLocalSettings(result.settings);
      setAiSettings(result.settings);
      setDraftKeys({});
      setClearedKeys({});
      toast.success("AI settings saved.");
    });
  }

  const originHint =
    typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";

  return (
    <div className="space-y-5">
      {!migrated && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertTitle>AI Settings table not migrated yet</AlertTitle>
          <AlertDescription>
            Run <code>supabase/migrations/20261049000000_ai_settings.sql</code> in the Supabase SQL
            Editor so API keys and AI configuration can be saved securely behind admin RLS.
          </AlertDescription>
        </Alert>
      )}

      <form id={formId} onSubmit={handleSave} noValidate>
        {formId && (
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
            Save changes
          </button>
        )}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <SparklesIcon className="size-4 text-primary" />
                  Nemesis AI &amp; Model Providers
                </CardTitle>
                <CardDescription>
                  Connect free or paid cloud APIs (Groq, OpenAI, Claude, Gemini, OpenRouter,
                  DeepSeek) or a local Ollama model (such as Qwen3.5 9B) to power the{" "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    ⌘K
                  </kbd>{" "}
                  Admin Agent.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onPress={() => openWithPrompt()}
              >
                <SparklesIcon className="size-3.5 text-primary" /> Launch AI Agent (⌘K)
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <FieldGroup className="gap-6">
              {/* 1. Master Enable Toggle */}
              <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BotIcon className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Enable Nemesis AI Agent</p>
                    <p className="text-xs text-muted-foreground">
                      Unlocks the global ⌘K command drawer across Products, Orders, Categories, and
                      SEO.
                    </p>
                  </div>
                </div>
                <Switch
                  id="ai_enabled"
                  aria-label="Enable Nemesis AI Agent"
                  isSelected={enabled}
                  onChange={setEnabled}
                />
              </div>

              {/* 2. Provider Grid */}
              <Field>
                <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                  <CpuIcon className="size-4 text-primary" />
                  1. Choose AI Provider
                </FieldLabel>
                <div className="mt-1 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {AI_PROVIDER_IDS.map((id) => {
                    const p = AI_PROVIDERS[id];
                    const ProviderIcon = PROVIDER_ICONS[id];
                    const active = provider === id;
                    const hasSavedKey = !clearedKeys[id] && settings.has_keys[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => handleSelectProvider(id)}
                        className={cn(
                          "flex cursor-pointer flex-col items-start rounded-xl border p-3 text-left transition-all",
                          active
                            ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                            : "hover:border-foreground/25 hover:bg-muted/40",
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              <ProviderIcon className="size-3.5" />
                            </span>
                            <span className="truncate text-xs font-semibold text-foreground">
                              {p.label}
                            </span>
                          </div>
                          {hasSavedKey && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckIcon className="size-2.5" />
                              Key set
                            </span>
                          )}
                        </div>
                        <span className="mt-2 text-[10px] font-medium text-primary">
                          {p.tierBadge}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <FieldDescription>{meta.description}</FieldDescription>
              </Field>

              <FieldSeparator />

              {/* 3. Credentials / Ollama Connection Mode */}
              {provider === "ollama" ? (
                <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <LaptopIcon className="size-4 text-primary" />
                      2. Local Ollama Connection Mode (e.g. Qwen3.5 9B)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["browser", "tunnel"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setOllamaMode(m)}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                            ollamaMode === m
                              ? "border-primary bg-primary text-primary-foreground"
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          {m === "browser" ? (
                            <MonitorIcon className="size-3.5" />
                          ) : (
                            <CloudIcon className="size-3.5" />
                          )}
                          {m === "browser"
                            ? "Browser-Direct (localhost)"
                            : "HTTPS Tunnel (Cloudflare / ngrok)"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="ollama_base_url" className="flex items-center gap-1.5">
                        <Link2Icon className="size-3.5 text-muted-foreground" />
                        {ollamaMode === "browser" ? "Local Ollama URL" : "Public HTTPS Tunnel URL"}
                      </FieldLabel>
                      <Input
                        id="ollama_base_url"
                        value={ollamaBaseUrl}
                        onChange={(e) => setOllamaBaseUrl(e.target.value)}
                        placeholder={
                          ollamaMode === "browser"
                            ? "http://localhost:11434"
                            : "https://your-tunnel.trycloudflare.com"
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ollama_num_ctx" className="flex items-center gap-1.5">
                        <CpuIcon className="size-3.5 text-muted-foreground" />
                        Context Window (num_ctx)
                      </FieldLabel>
                      <Input
                        id="ollama_num_ctx"
                        type="number"
                        min={2048}
                        max={131072}
                        step={1024}
                        value={ollamaNumCtx}
                        onChange={(e) => setOllamaNumCtx(e.target.value)}
                      />
                      <FieldDescription>
                        4096 recommended for 6–8 GB VRAM GPUs (prevents CUDA / llama-server crashes).
                      </FieldDescription>
                    </Field>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/12 text-amber-600 dark:text-amber-400">
                        <ZapIcon className="size-3.5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium">
                          Fast Tool-Calling Mode (Disable Qwen3/3.5 Chain-of-Thought)
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Sends <code>think: false</code> so local Qwen3.5 9B responds 3–5× faster on
                          your GPU.
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="ollama_disable_thinking"
                      aria-label="Fast Tool-Calling Mode"
                      isSelected={ollamaDisableThinking}
                      onChange={setOllamaDisableThinking}
                    />
                  </div>

                  {ollamaMode === "browser" ? (
                    <div className="space-y-2 rounded-lg border bg-background p-3 text-xs text-muted-foreground">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <TerminalIcon className="size-3.5 text-primary" />
                        How Browser-Direct Mode connects your live site to your PC:
                      </p>
                      <p>
                        Allow browser CORS in Ollama, then open <code>/nemesis</code> on this PC:
                      </p>
                      <div>
                        <span className="text-[11px] font-medium text-foreground">
                          Windows PowerShell:
                        </span>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                          {`Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue; $env:OLLAMA_ORIGINS="*"; ollama serve`}
                        </pre>
                      </div>
                      <div>
                        <span className="text-[11px] font-medium text-foreground">
                          macOS / Linux:
                        </span>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                          {`OLLAMA_ORIGINS="${originHint}" ollama serve`}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="ollama_tunnel_key" className="flex items-center gap-1.5">
                        <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                        Optional Tunnel Bearer Token
                      </FieldLabel>
                      <Input
                        id="ollama_tunnel_key"
                        type="password"
                        autoComplete="off"
                        value={typedKey}
                        onChange={(e) => {
                          setDraftKeys((prev) => ({ ...prev, ollama: e.target.value }));
                          setClearedKeys((prev) => ({ ...prev, ollama: false }));
                        }}
                        placeholder={storedMask ? `Saved (${storedMask})` : meta.keyPlaceholder}
                      />
                    </Field>
                  )}
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel
                        htmlFor="ai_api_key"
                        className="flex items-center gap-2 text-sm font-semibold"
                      >
                        <KeyRoundIcon className="size-4 text-primary" />
                        2. {meta.label} API Key
                      </FieldLabel>
                      {meta.consoleUrl && (
                        <a
                          href={meta.consoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Get key <ExternalLinkIcon className="size-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        id="ai_api_key"
                        type="password"
                        autoComplete="off"
                        value={typedKey}
                        onChange={(e) => {
                          setDraftKeys((prev) => ({ ...prev, [provider]: e.target.value }));
                          setClearedKeys((prev) => ({ ...prev, [provider]: false }));
                        }}
                        placeholder={
                          storedMask
                            ? `Saved: ${storedMask} (leave blank to keep)`
                            : meta.keyPlaceholder
                        }
                      />
                      {storedMask && !usingEnvKey && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Clear saved API key"
                          onPress={() => {
                            setClearedKeys((prev) => ({ ...prev, [provider]: true }));
                            setDraftKeys((prev) => ({ ...prev, [provider]: "" }));
                          }}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      )}
                    </div>
                    <FieldDescription className="flex items-center gap-1.5">
                      <ShieldCheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      {storedMask
                        ? usingEnvKey
                          ? `Using environment variable (${storedMask}). Enter a key above to override.`
                          : `Stored in admin-only RLS table (${storedMask}). Keys are never exposed to storefront visitors.`
                        : "Stored per-provider in admin-only RLS table so you can switch models anytime."}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel
                      htmlFor="custom_base_url"
                      className="flex items-center gap-1.5 text-sm font-semibold"
                    >
                      <GlobeIcon className="size-4 text-muted-foreground" />
                      {provider === "custom"
                        ? "Endpoint Base URL (/v1)"
                        : "Custom Base URL Override (Optional)"}
                    </FieldLabel>
                    <Input
                      id="custom_base_url"
                      type="url"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder={meta.defaultBaseUrl}
                    />
                    <FieldDescription>
                      Default: <code>{meta.defaultBaseUrl}</code>
                    </FieldDescription>
                  </Field>
                </div>
              )}

              <FieldSeparator />

              {/* 4. Primary + Fallback Model Picker */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                    <LayersIcon className="size-4 text-primary" />
                    3. Model Selection &amp; Failover
                  </FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      isPending={loadingModels}
                      isDisabled={loadingModels}
                      onPress={() => void handleFetchModels()}
                    >
                      {loadingModels ? <Spinner /> : <RefreshCwIcon className="size-3.5" />}
                      {provider === "ollama" && ollamaMode === "browser"
                        ? "Detect Local Models"
                        : "Fetch Live Models"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isPending={testing}
                      isDisabled={testing}
                      onPress={() => void handleTestConnection()}
                    >
                      {testing ? <Spinner /> : <ZapIcon className="size-3.5 text-primary" />}
                      Test Connection
                    </Button>
                  </div>
                </div>

                {meta.models.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setPrimaryModel(m.id);
                          if (m.vision !== undefined) setVisionEnabled(Boolean(m.vision));
                        }}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                          primaryModel === m.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-muted/40 hover:border-primary/40 hover:bg-muted",
                        )}
                      >
                        <BotIcon className="size-3 opacity-80" />
                        <span>{m.label}</span>
                        {m.vision && (
                          <EyeIcon
                            className="size-3 opacity-80"
                            aria-label="Supports vision"
                          />
                        )}
                        {m.badge && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.2 text-[10px]",
                              primaryModel === m.id
                                ? "bg-white/20 text-primary-foreground"
                                : "bg-background text-muted-foreground",
                            )}
                          >
                            {m.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {fetchedModels.length > 0 && (
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <CpuIcon className="size-3.5" />
                      Live models returned by {meta.label} (click to select):
                    </p>
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {fetchedModels.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setPrimaryModel(id)}
                          className={cn(
                            "cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[11px]",
                            primaryModel === id
                              ? "border-primary bg-primary text-primary-foreground"
                              : "bg-background hover:border-primary/40",
                          )}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {testResult && (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs",
                      testResult.ok
                        ? "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-800 dark:text-emerald-200"
                        : "border-destructive/40 bg-destructive/[0.08] text-destructive",
                    )}
                  >
                    {testResult.ok ? (
                      <CheckCircle2Icon className="size-4 shrink-0" />
                    ) : (
                      <AlertCircleIcon className="size-4 shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="primary_model" className="flex items-center gap-1.5">
                      <BotIcon className="size-3.5 text-primary" />
                      Primary Agent Model ID
                    </FieldLabel>
                    <Input
                      id="primary_model"
                      value={primaryModel}
                      onChange={(e) => setPrimaryModel(e.target.value)}
                      placeholder={meta.defaultPrimaryModel || "e.g. openai/gpt-oss-120b"}
                      required
                    />
                    <FieldDescription>
                      Handles planning, tool-calling, analytics, and multi-step commands.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="fallback_model" className="flex items-center gap-1.5">
                      <GitBranchIcon className="size-3.5 text-muted-foreground" />
                      Fallback / Bulk Copy Worker Model (Optional)
                    </FieldLabel>
                    <Input
                      id="fallback_model"
                      value={fallbackModel}
                      onChange={(e) => setFallbackModel(e.target.value)}
                      placeholder={meta.defaultFallbackModel ?? "e.g. openai/gpt-oss-20b"}
                    />
                    <FieldDescription>
                      Used for bulk SEO copywriting and automatic failover on 429 rate limits.
                    </FieldDescription>
                  </Field>
                </div>
              </div>

              <FieldSeparator />

              {/* 5. Token Budget, Reasoning & Safety */}
              <div className="space-y-4">
                <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                  <GaugeIcon className="size-4 text-primary" />
                  4. Rate-Limit Budget, Reasoning &amp; Safety
                </FieldLabel>
                <div className="grid gap-3 sm:grid-cols-3">
                  {BUDGET_OPTIONS.map(({ id, title, desc, icon: BudgetIcon, iconTone }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBudgetMode(id)}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3 text-left transition-all",
                        budgetMode === id
                          ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                          : "hover:bg-muted/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md",
                              iconTone,
                            )}
                          >
                            <BudgetIcon className="size-3.5" />
                          </span>
                          <span className="text-xs font-semibold">{title}</span>
                        </div>
                        {budgetMode === id && <Badge variant="default">Active</Badge>}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                        {desc}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel className="flex items-center gap-1.5">
                      <BrainCircuitIcon className="size-3.5 text-muted-foreground" />
                      Reasoning Effort (GPT OSS / o-series)
                    </FieldLabel>
                    <div className="mt-1 flex gap-2">
                      {(["low", "medium", "high"] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setReasoningEffort(lvl)}
                          className={cn(
                            "flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium capitalize transition-colors",
                            reasoningEffort === lvl
                              ? "border-primary bg-primary text-primary-foreground"
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          {lvl} {lvl === "low" ? "(Fast)" : ""}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai_temperature" className="flex items-center gap-1.5">
                      <ThermometerIcon className="size-3.5 text-muted-foreground" />
                      Temperature (0.0 – 1.0)
                    </FieldLabel>
                    <Input
                      id="ai_temperature"
                      type="number"
                      min={0}
                      max={2}
                      step={0.05}
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheckIcon className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">Require Confirmation Preview</p>
                        <p className="text-[11px] text-muted-foreground">
                          Always show an interactive &ldquo;Apply All&rdquo; preview before writing
                          to Supabase.
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="require_confirmation"
                      aria-label="Require Confirmation Preview"
                      isSelected={requireConfirmation}
                      onChange={setRequireConfirmation}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-400">
                        <EyeIcon className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">Model Supports Vision</p>
                        <p className="text-[11px] text-muted-foreground">
                          Enable when using multimodal models (GPT-4.1/4o, Claude, Gemini, Llama 4).
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="vision_enabled"
                      aria-label="Model Supports Vision"
                      isSelected={visionEnabled}
                      onChange={setVisionEnabled}
                    />
                  </div>
                </div>
              </div>

              <FieldSeparator />

              {/* 6. Brand Voice & Store Instructions */}
              <div className="space-y-4">
                <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                  <MegaphoneIcon className="size-4 text-primary" />
                  5. Store Brand Voice &amp; Custom Instructions
                </FieldLabel>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="brand_tone" className="flex items-center gap-1.5">
                      <PenToolIcon className="size-3.5 text-muted-foreground" />
                      Brand Writing Tone
                    </FieldLabel>
                    <Input
                      id="brand_tone"
                      maxLength={60}
                      value={brandTone}
                      onChange={(e) => setBrandTone(e.target.value)}
                      placeholder="modern, trustworthy, concise"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="default_language" className="flex items-center gap-1.5">
                      <LanguagesIcon className="size-3.5 text-muted-foreground" />
                      Default Output Language
                    </FieldLabel>
                    <Input
                      id="default_language"
                      maxLength={60}
                      value={defaultLanguage}
                      onChange={(e) => setDefaultLanguage(e.target.value)}
                      placeholder="English (or Bangla / Bilingual)"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="system_instructions" className="flex items-center gap-1.5">
                    <ScrollTextIcon className="size-3.5 text-muted-foreground" />
                    Custom Store Rules / Instructions (Optional)
                  </FieldLabel>
                  <Textarea
                    id="system_instructions"
                    rows={3}
                    maxLength={2000}
                    value={systemInstructions}
                    onChange={(e) => setSystemInstructions(e.target.value)}
                    placeholder="e.g. Never discount Apple flagship items by more than 15%. Highlight fast Dhaka delivery and official warranty in SEO descriptions."
                  />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>

          {!formId && (
            <CardFooter className="justify-between gap-3 border-t">
              <Button type="submit" isPending={saving} isDisabled={saving}>
                {saving ? <Spinner /> : <SaveIcon />}
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">⌘K</kbd>{" "}
                anywhere in admin to open the agent.
              </span>
            </CardFooter>
          )}
        </Card>
      </form>
    </div>
  );
}
