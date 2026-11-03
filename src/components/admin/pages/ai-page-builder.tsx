"use client";

import { useEffect, useRef, useState } from "react";
import { SparklesIcon, Undo2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { blocksToHtml, type PageBlock } from "@/lib/pages/blocks";
import { PAGE_CONTENT_MAX } from "@/lib/pages/shared";
import type { DesignPreview } from "@/lib/pages/ai-design";
import type { BlockEditorController } from "./block-editor";

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
  const [open, setOpen] = useState(false);
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
      className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4"
      aria-label="AI page builder"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <SparklesIcon className="size-4 text-primary" aria-hidden /> Build
            with AI
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Editable blocks · Supported Tailwind styles · Page content only
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          onPress={() => setOpen(!open)}
        >
          {open ? "Hide builder" : "Generate page with AI"}
        </Button>
      </div>
      {open && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Uses your connected model in{" "}
            <a
              className="underline"
              href="/nemesis/settings?tab=ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Settings → AI
            </a>
            . Your prompt, page title and up to 12 recent library image
            names/alt descriptions and 12 recent product names are sent to that
            model. Existing page content is not sent.
          </p>
          <label className="block space-y-2 text-sm font-medium">
            <span>Describe your page or sections</span>
            <textarea
              className="min-h-28 w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={prompt}
              maxLength={3000}
              disabled={busy || disabled}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Create a warm, minimal collection page with a hero, three benefits and a shop button. Include the business facts and links you want to use."
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              isDisabled={busy || disabled || !prompt.trim()}
              onPress={() => void generate()}
            >
              {busy ? <Spinner /> : <SparklesIcon />}
              {busy ? "Generating preview…" : "Generate preview"}
            </Button>
            {busy && (
              <Button type="button" size="sm" variant="ghost" onPress={cancel}>
                <XIcon />
                Cancel generation
              </Button>
            )}
            {undo && (
              <Button
                type="button"
                size="sm"
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
          </div>
          {undo && !canUndo && (
            <p className="text-xs text-muted-foreground">
              Content changed after applying. Undo is disabled to protect your
              newer edits.
            </p>
          )}
          {preview && (
            <div className="space-y-3 rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Suggested design · {preview.blocks.length} top-level blocks
                </p>
                <span className="text-xs text-muted-foreground">
                  {preview.model}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Validated structure and size · Trusted styles · Review facts,
                heading order, image descriptions and links before publishing.
              </p>
              <div
                className="max-h-[600px] overflow-auto rounded-lg border border-border bg-background p-4"
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
              <label className="block space-y-1 text-xs font-medium">
                <span>Apply behavior</span>
                <select
                  className="w-full rounded-md border border-border bg-background p-2 text-foreground"
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "append" | "replace")
                  }
                >
                  <option value="append">
                    Append to current content (recommended)
                  </option>
                  <option value="replace">Replace current page content</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  isDisabled={disabled || busy}
                  onPress={apply}
                >
                  {mode === "append"
                    ? "Append editable blocks"
                    : "Replace page content"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onPress={() => setPreview(null)}
                >
                  Discard preview
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Title, slug, featured image, tags and SEO settings stay
                unchanged. Applying does not save or publish.
              </p>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  );
}
