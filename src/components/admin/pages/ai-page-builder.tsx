"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  InfoIcon,
  LayoutTemplateIcon,
  SparklesIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { blocksToHtml, type PageBlock } from "@/lib/pages/blocks";
import { PAGE_CONTENT_MAX } from "@/lib/pages/shared";
import type { DesignPreview } from "@/lib/pages/ai-design";
import type { BlockEditorController } from "./block-editor";
import { BlockVisualPreview, sectionLabel } from "./block-visual-preview";
import { useNemesisAi } from "../ai/ai-context";
import { AI_PROVIDERS } from "@/lib/ai/providers";

type BrowserPlan = {
  transport: "browser";
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  numCtx: number;
  disableThinking: boolean;
};

async function limitedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response received.");
  let raw = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 450_000) {
        await reader.cancel();
        throw new Error("The response is too large. Request fewer sections.");
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(raw + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid response.");
    return value as Record<string, unknown>;
  } finally {
    reader.releaseLock();
  }
}
async function designRequest(body: unknown, signal: AbortSignal) {
  const response = await fetch("/api/nemesis/ai/page-design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await limitedJson(response);
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Generation failed. Your editor is unchanged.",
    );
  return data;
}

/** Browser-direct Ollama is intentional: this reaches the admin's machine, not the web server. */
async function localDesign(
  plan: BrowserPlan,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${plan.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: plan.model,
        stream: false,
        format: "json",
        ...(plan.disableThinking ? { think: false } : {}),
        messages: [
          { role: "system", content: plan.systemPrompt },
          { role: "user", content: plan.userPrompt },
        ],
        options: {
          temperature: 0.5,
          num_ctx: plan.numCtx,
          num_predict: plan.maxTokens,
        },
      }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Could not reach local Ollama. Check that it is running and allows this admin site's origin (OLLAMA_ORIGINS). Browser network permissions or mixed-content rules may require an HTTPS tunnel configured in Settings → AI.",
    );
  }
  if (!response.ok)
    throw new Error(
      "Local Ollama could not generate the design. Check the selected model and Ollama status in Settings → AI.",
    );
  const data = await limitedJson(response);
  const message = data.message as { content?: unknown } | undefined;
  if (typeof message?.content !== "string")
    throw new Error("Ollama returned no design content.");
  // Browser model output never enters the editor/DOM until server validation succeeds.
  return designRequest({ action: "validate", raw: message.content }, signal);
}

function freshIds(blocks: PageBlock[]): PageBlock[] {
  return blocks.map((block) => ({
    ...block,
    id: `ai-${crypto.randomUUID()}`,
    ...(block.layoutCells
      ? { layoutCells: block.layoutCells.map(freshIds) }
      : {}),
  }));
}

export function AiPageBuilder({
  controller,
  title,
  disabled,
}: {
  controller: BlockEditorController;
  title: string;
  disabled: boolean;
}) {
  const { aiSettings } = useNemesisAi();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DesignPreview | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [undo, setUndo] = useState<{
    before: PageBlock[];
    appliedHtml: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );

  async function generate() {
    if (busy || disabled || !prompt.trim()) return;
    const id = ++generation.current;
    const abort = new AbortController();
    request.current = abort;
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(165_000),
    ]);
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    try {
      let result = await designRequest(
        { action: "generate", prompt, title },
        signal,
      );
      if (result.transport === "browser")
        result = await localDesign(result as BrowserPlan, signal);
      if (generation.current !== id) return;
      if (!Array.isArray(result.blocks) || typeof result.html !== "string")
        throw new Error("Invalid design preview.");
      setPreview(result as DesignPreview);
    } catch (err) {
      if (generation.current === id)
        setError(
          signal.aborted
            ? "Generation timed out. Try fewer sections or check your model connection. Your editor is unchanged."
            : err instanceof Error
              ? err.message
              : "Could not generate a design.",
        );
    } finally {
      if (generation.current === id) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setNotice("Generation cancelled. Your editor is unchanged.");
  }
  function apply() {
    if (!preview || disabled) return;
    if (
      mode === "replace" &&
      controller.blocks.length &&
      !window.confirm(
        "Replace all current page content with this design? Title, slug, featured image and SEO settings will not change. You can undo this until you edit the content again.",
      )
    )
      return;
    const incoming = freshIds(preview.blocks);
    const next =
      mode === "append" ? [...controller.blocks, ...incoming] : incoming;
    const html = blocksToHtml(next);
    if (html.length > PAGE_CONTENT_MAX) {
      setError(
        "The combined content is too large. Use fewer sections or replace existing content.",
      );
      return;
    }
    setUndo({ before: structuredClone(controller.blocks), appliedHtml: html });
    controller.replaceBlocks(next);
    setPreview(null);
    setError("");
    setNotice(
      "Design applied as editable blocks. Review the content, then use Save draft or Update. Nothing was saved or published automatically.",
    );
  }
  const canUndo = undo !== null && controller.html === undo.appliedHtml;

  return (
    <section
      data-ai-builder
      className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs"
      aria-label="AI page builder"
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <SparklesIcon className="size-5 text-primary" aria-hidden />
              Build with AI
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate editable sections, not code.
            </p>
          </div>
          <a
            href="/nemesis/settings?tab=ai"
            target="_blank"
            rel="noopener noreferrer"
            title={
              aiSettings.is_ready
                ? `${AI_PROVIDERS[aiSettings.provider].label} · ${aiSettings.primary_model} configured; connectivity checked on generation`
                : "Configure a model in Settings → AI"
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium"
          >
            <span
              className={
                aiSettings.is_ready
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {aiSettings.is_ready ? "Model configured" : "Connect model"}
          </a>
        </div>
        <label className="block space-y-2 text-sm font-medium">
          <span className="sr-only">Describe your page or sections</span>
          <div className="rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
            <textarea
              className="min-h-36 w-full resize-y bg-transparent p-3 text-sm font-normal text-foreground outline-none"
              value={prompt}
              maxLength={3000}
              disabled={busy || disabled}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Create a warm, minimal summer collection page with a hero and three benefits."
            />
            <p className="px-3 pb-2 text-right text-[10px] font-normal tabular-nums text-muted-foreground">
              {prompt.length.toLocaleString()} / 3,000
            </p>
          </div>
        </label>
        <label className="block">
          <span className="sr-only">Generation scope</span>
          <select
            aria-label="Generation scope"
            className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-muted-foreground"
            value="body"
            onChange={() => {}}
          >
            <option value="body">Scope: Page content only</option>
          </select>
        </label>
        <Button
          type="button"
          className="w-full"
          isDisabled={busy || disabled || !prompt.trim()}
          onPress={() => void generate()}
        >
          {busy ? <Spinner /> : <SparklesIcon />}
          {busy ? "Generating preview…" : "Generate preview"}
        </Button>
        {busy && (
          <Button
            type="button"
            size="sm"
            className="w-full"
            variant="ghost"
            onPress={cancel}
          >
            <XIcon />
            Cancel generation
          </Button>
        )}
        <details className="text-[11px] leading-5 text-muted-foreground">
          <summary className="cursor-pointer">Model &amp; data sharing</summary>
          <p className="mt-2">
            Uses{" "}
            <a
              className="underline"
              href="/nemesis/settings?tab=ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Settings → AI
            </a>
            . Your prompt, page title, up to 12 recent image names/alt
            descriptions and 12 recent product names are sent to that model.
            Existing page content is not sent.
          </p>
        </details>
      </div>
      <div className="space-y-4 border-t border-border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Suggested design</h3>
          {preview && (
            <span
              className="max-w-40 truncate text-[10px] text-muted-foreground"
              title={preview.model}
            >
              {preview.model}
            </span>
          )}
        </div>
        {preview ? (
          <>
            <div className="space-y-2">
              {preview.blocks.map((block) => (
                <div
                  key={block.id}
                  className="flex min-w-0 items-center gap-3 rounded-md border border-border p-2"
                >
                  <div
                    className="relative h-16 w-24 shrink-0 overflow-hidden rounded bg-muted"
                    aria-hidden
                  >
                    <div className="pointer-events-none absolute left-0 top-0 w-[640px] origin-top-left scale-[0.15]">
                      <BlockVisualPreview block={block} />
                    </div>
                  </div>
                  <LayoutTemplateIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="text-xs font-medium">{sectionLabel(block)}</p>
                </div>
              ))}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Inspect full design preview
              </summary>
              <div
                className="mt-3 max-h-96 overflow-auto rounded-lg border border-border bg-background p-3"
                role="region"
                aria-label="Generated page content preview"
                tabIndex={0}
              >
                <div
                  inert
                  className="space-y-6"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Preview width affects column wrapping. Review the saved page
                preview for the full storefront layout.
              </p>
            </details>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Supported styles",
                "Validated structure",
                "Within size limits",
              ].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-600/10 bg-emerald-500/5 px-2 py-1 text-[9px]"
                >
                  <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
                  {label}
                </span>
              ))}
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Apply behavior</span>
              <select
                className="w-full rounded-md border border-border bg-background p-2 text-foreground"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "append" | "replace")
                }
              >
                <option value="append">Append to existing content</option>
                <option value="replace">Replace page content (confirm)</option>
              </select>
            </label>
          </>
        ) : (
          <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center">
            <div>
              <LayoutTemplateIcon className="mx-auto mb-2 size-6 text-muted-foreground/60" />
              <p className="text-xs font-medium">Your design starts here</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Describe your page above to preview editable sections before
                applying.
              </p>
            </div>
          </div>
        )}
        <p className="flex items-start gap-2 rounded-md border border-primary/10 bg-primary/5 p-2.5 text-[11px] leading-5 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
          Title, slug, featured image and SEO settings stay unchanged.
        </p>
        {preview && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              isDisabled={disabled || busy}
              onPress={() => setPreview(null)}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              isDisabled={disabled || busy}
              onPress={apply}
            >
              {mode === "replace"
                ? "Replace content"
                : `Apply ${preview.blocks.length} ${preview.blocks.length === 1 ? "section" : "sections"}`}
            </Button>
          </div>
        )}
        <p className="text-center text-[10px] leading-5 text-muted-foreground">
          Review before saving. Nothing is published automatically.
        </p>
        {undo && (
          <Button
            type="button"
            size="sm"
            className="w-full"
            variant="outline"
            isDisabled={!canUndo || disabled || busy}
            onPress={() => {
              if (!undo || !canUndo) return;
              controller.replaceBlocks(undo.before);
              setUndo(null);
              setNotice("Restored the content from before applying AI.");
            }}
          >
            <Undo2Icon />
            Undo last apply
          </Button>
        )}
        {undo && !canUndo && (
          <p className="text-xs text-muted-foreground">
            Undo is disabled to protect edits made after applying.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs leading-5 text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
