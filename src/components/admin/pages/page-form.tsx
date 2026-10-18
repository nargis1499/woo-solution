"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CalendarIcon, ExternalLinkIcon, EyeIcon, GlobeIcon, UserIcon } from "lucide-react";
import { checkPageSlug, savePage } from "@/app/nemesis/pages/actions";
import type { AdminFormState } from "@/lib/admin/form";
import { formatDate } from "@/lib/format";
import { PAGE_TITLE_MAX, featuredImage, pageHref, pagePreviewHref, shareImage, slugifyPage } from "@/lib/pages/shared";
import type { Page } from "@/lib/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useFormToast } from "../flash-toast";
import { MediaRefField } from "../media/media-ref-field";
import { BlockEditorCanvas, BlockSettingsInspector, useBlockEditorState } from "./block-editor";
import { PageStatusBadge } from "./page-status-badge";
import { SeoSettings } from "./seo-settings";
import { TagInput } from "./tag-input";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { cn } from "@/lib/utils";

type Intent = "draft" | "publish" | "update" | "unpublish";

/**
 * Create / edit a CMS page. One form, one Server Action (`savePage`); the
 * buttons only differ in the `intent` they send. Dispatched from onSubmit (not
 * `<form action>`) so React never resets the editor, the tag chips or the
 * switches after a save.
 */
type PageFormProps = {
  page?: Page | null;
  /** Names of every existing tag (autocomplete). */
  tagSuggestions: string[];
  /** Settings → SEO → site URL (null when unknown). */
  siteUrl: string | null;
  storeName: string;
  /** List URL (page / size / filter) to go back to. */
  returnTo?: string;
};

export function PageForm(props: PageFormProps) {
  const [state, dispatch, isPending] = useActionState<AdminFormState, FormData>(savePage, null);
  useFormToast(state);
  // No remount key here on purpose: every field in this editor is controlled (title, slug, body,
  // tags, switches), so a save already redraws it from `state`/fresh props – while a remount would
  // slam the open SEO panel, the tag chips and the cursor shut on every save. The action state
  // lives in this wrapper so its toast is reported exactly once per result.
  return <PageFields {...props} state={state} dispatch={dispatch} isPending={isPending} />;
}

function PageFields({
  page,
  tagSuggestions,
  siteUrl,
  storeName,
  returnTo = "/nemesis/pages",
  state,
  dispatch,
  isPending,
}: PageFormProps & {
  state: AdminFormState;
  dispatch: (formData: FormData) => void;
  isPending: boolean;
}) {
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const isEdit = Boolean(page);
  const isPublished = page?.status === "published";

  const [title, setTitle] = useState(v.title ?? page?.title ?? "");
  // slug auto-follows the title until the admin edits it by hand (or the page already has one)
  const [slugTouched, setSlugTouched] = useState(Boolean(page?.slug));
  const [slug, setSlug] = useState(v.slug ?? page?.slug ?? "");
  const [content, setContent] = useState(v.content ?? page?.content ?? "");
  const [inspectorTab, setInspectorTab] = useState<"block" | "meta">("block");
  const featured = page ? featuredImage(page) : null;
  const [featuredPicked, setFeaturedPicked] = useState(Boolean(featured));
  const intentRef = useRef<Intent>("draft");
  const [submitted, setSubmitted] = useState<Intent | null>(null);

  // ── unsaved changes ───────────────────────────────────────────────────────
  const [dirty, setDirty] = useState(false);
  const blockController = useBlockEditorState({
    initialHtml: content,
    onChange: (nextHtml) => {
      setContent(nextHtml);
      setDirty(true);
    },
  });
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    // derived-state reset during render: a successful save means nothing is unsaved any more
    setSeenState(state);
    if (state?.success) setDirty(false);
  }
  useUnsavedChanges(dirty && !isPending);

  // ── live slug availability ────────────────────────────────────────────────
  const slugCheck = useSlugCheck(slug, page?.id ?? null, page?.slug ?? null);
  const slugError = err.slug ?? (slugCheck && !slugCheck.ok ? `${slugCheck.reason}${slugCheck.suggestion ? ` Try "/${slugCheck.suggestion}".` : ""}` : undefined);

  return (
    <form
      noValidate
      className="grid gap-6 lg:grid-cols-[1fr_340px]"
      data-testid="page-form"
      // Events from portalled dialogs (media picker) bubble through the React tree:
      // only react to the page form's own fields / its own submit.
      onChange={(e) => {
        if (e.currentTarget.contains(e.target as Node)) setDirty(true);
      }}
      onSubmit={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (isPending) return; // no double submits
        const formData = new FormData(e.currentTarget);
        formData.set("intent", intentRef.current);
        setSubmitted(intentRef.current);
        startTransition(() => dispatch(formData));
      }}
    >
      {page && <input type="hidden" name="id" value={page.id} />}
      <input type="hidden" name="return_to" value={returnTo} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={Boolean(err.title) || undefined}>
                  <FieldLabel htmlFor="title">Title</FieldLabel>
                  <Input
                    id="title"
                    name="title"
                    required
                    maxLength={PAGE_TITLE_MAX}
                    value={title}
                    placeholder="About us"
                    className="text-base font-medium"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (!slugTouched) setSlug(slugifyPage(e.target.value));
                    }}
                    aria-invalid={Boolean(err.title) || undefined}
                  />
                  <FieldError>{err.title}</FieldError>
                </Field>

                <Field data-invalid={Boolean(slugError) || undefined}>
                  <FieldLabel htmlFor="slug">URL slug</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText className="max-w-36 truncate" title={siteUrl ?? undefined}>
                        {siteUrl ? siteUrl.replace(/^https?:\/\//, "") : ""}/
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="slug"
                      name="slug"
                      value={slug}
                      placeholder="about-us"
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                      }}
                      onBlur={() => setSlug((s) => slugifyPage(s))}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      aria-invalid={Boolean(slugError) || undefined}
                      aria-describedby="slug-hint"
                    />
                    {slugCheck?.pending && (
                      <InputGroupAddon align="inline-end">
                        <Spinner className="size-3.5" />
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  {slugError ? (
                    <FieldError>
                      {slugError}
                      {slugCheck?.suggestion && !err.slug && (
                        <>
                          {" "}
                          <button type="button" className="underline underline-offset-4" onClick={() => { setSlugTouched(true); setSlug(slugCheck.suggestion!); }}>
                            Use it
                          </button>
                        </>
                      )}
                    </FieldError>
                  ) : (
                    <FieldDescription id="slug-hint">
                      {isEdit && page?.slug !== slug && slug ? (
                        <span className="text-amber-600 dark:text-amber-400">Changing the slug changes the public URL – old links will stop working.</span>
                      ) : (
                        <>Public address: <span className="font-mono">{pageHref(slug || "about-us")}</span></>
                      )}
                    </FieldDescription>
                  )}
                </Field>
              </div>

              <Field data-invalid={Boolean(err.content) || undefined}>
                <FieldLabel>Page content</FieldLabel>
                <BlockEditorCanvas
                  controller={blockController}
                  name="content"
                  invalid={Boolean(err.content)}
                />
                <FieldError>{err.content}</FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      {/* ── sidebar: publish + Block Settings / Page Meta inspector ─────────── */}
      <aside className="space-y-6">
        <Card data-testid="publish-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              Publish
              <PageStatusBadge status={page?.status ?? "draft"} />
            </CardTitle>
            {page && (
              <CardDescription>
                <dl className="mt-1 space-y-1 text-xs">
                  {page.author && (
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="size-3.5" aria-hidden />
                      <dt className="sr-only">Author</dt>
                      <dd>{page.author.full_name || page.author.email || "Unknown"}</dd>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="size-3.5" aria-hidden />
                    <dt className="sr-only">Last updated</dt>
                    <dd>Updated {formatDate(page.updated_at)}</dd>
                  </div>
                  {page.published_at && page.status === "published" && (
                    <div className="flex items-center gap-1.5">
                      <GlobeIcon className="size-3.5" aria-hidden />
                      <dt className="sr-only">Published</dt>
                      <dd>Published {formatDate(page.published_at)}</dd>
                    </div>
                  )}
                </dl>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {isPublished ? (
                <>
                  <IntentButton intent="update" intentRef={intentRef} pending={isPending} active={submitted === "update"} pendingLabel="Saving…" testId="save-update">
                    Update
                  </IntentButton>
                  <IntentButton intent="unpublish" intentRef={intentRef} pending={isPending} active={submitted === "unpublish"} variant="outline" pendingLabel="Saving…" testId="save-unpublish">
                    Unpublish
                  </IntentButton>
                </>
              ) : (
                <>
                  <IntentButton intent="draft" intentRef={intentRef} pending={isPending} active={submitted === "draft"} variant="outline" pendingLabel="Saving…" testId="save-draft">
                    Save draft
                  </IntentButton>
                  <IntentButton intent="publish" intentRef={intentRef} pending={isPending} active={submitted === "publish"} pendingLabel="Publishing…" testId="save-publish">
                    Publish
                  </IntentButton>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {page && (
                <LinkButton href={pagePreviewHref(page.id)} target="_blank" variant="ghost" size="sm" data-testid="preview-link">
                  <EyeIcon /> Preview
                </LinkButton>
              )}
              {page && isPublished && (
                <LinkButton href={pageHref(page.slug)} target="_blank" variant="ghost" size="sm" data-testid="view-live-link">
                  <ExternalLinkIcon /> View live
                </LinkButton>
              )}
              <LinkButton href={returnTo} variant="ghost" size="sm" className="ml-auto">
                Cancel
              </LinkButton>
            </div>
            {!page && <p className="text-xs text-muted-foreground">Save once to unlock the preview.</p>}
            {dirty && <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="unsaved-hint">Unsaved changes</p>}
          </CardContent>
        </Card>

        {/* Block Settings | Page Meta Tabbed Inspector matching image-1.png & image-3.png */}
        <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs">
          <div className="grid grid-cols-2 border-b border-border" role="tablist" aria-label="Editor inspector">
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "block"}
              data-testid="tab-block-settings"
              onClick={() => setInspectorTab("block")}
              className={cn(
                "border-b-2 py-3 text-center text-xs font-semibold transition-colors",
                inspectorTab === "block"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Block Settings
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "meta"}
              data-testid="tab-page-meta"
              onClick={() => setInspectorTab("meta")}
              className={cn(
                "border-b-2 py-3 text-center text-xs font-semibold transition-colors",
                inspectorTab === "meta"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Page Meta
            </button>
          </div>

          <div className={cn(inspectorTab !== "block" && "hidden")}>
            <BlockSettingsInspector controller={blockController} />
          </div>

          <div className={cn("space-y-5 p-4", inspectorTab !== "meta" && "hidden")}>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Featured image</p>
              <MediaRefField
                name="featured_image"
                label="Image"
                shape="wide"
                currentUrl={featured?.src ?? null}
                currentMedia={featured?.media ?? null}
                error={err.featured_image_media_id ?? err.featured_image_url}
                allowUrl
                onChange={(has) => { setFeaturedPicked(has); setDirty(true); }}
                picker={{
                  kind: "image",
                  title: "Featured image",
                  description: "Pick an image from the Media Library or upload a new one. Its alt text (editable in the library) is used on the page.",
                  confirmLabel: "Use as featured image",
                }}
              />
            </div>

            <hr className="border-border/70" />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Tags</p>
              <TagInput id="tags" name="tags" suggestions={tagSuggestions} defaultValue={v.tags ? v.tags.split("\n") : (page?.tags ?? []).map((t) => t.name)} onChange={() => setDirty(true)} />
              <FieldError className="mt-2">{err.tags}</FieldError>
            </div>

            <hr className="border-border/70" />

            <SeoSettings
              values={{
                seo_title: v.seo_title ?? page?.seo_title ?? "",
                seo_description: v.seo_description ?? page?.seo_description ?? "",
                canonical_url: v.canonical_url ?? page?.canonical_url ?? "",
                robots_index: v.robots_index ? v.robots_index !== "off" : (page?.robots_index ?? true),
                robots_follow: v.robots_follow ? v.robots_follow !== "off" : (page?.robots_follow ?? true),
                og_title: v.og_title ?? page?.og_title ?? "",
                og_description: v.og_description ?? page?.og_description ?? "",
              }}
              errors={err}
              pageTitle={title}
              slug={slug}
              contentHtml={content}
              siteUrl={siteUrl}
              storeName={storeName}
              ogImage={page ? shareImage(page) : null}
              hasFeaturedImage={featuredPicked}
              defaultOpen={Boolean(err.seo_title || err.seo_description || err.canonical_url || err.og_title || err.og_description || err.og_image_media_id)}
            />
          </div>
        </div>
      </aside>
    </form>
  );
}

function IntentButton({
  intent,
  intentRef,
  pending,
  active,
  pendingLabel,
  variant = "default",
  children,
  testId,
}: {
  intent: Intent;
  intentRef: React.RefObject<Intent>;
  pending: boolean;
  /** This button's intent is the one being saved right now. */
  active: boolean;
  pendingLabel: string;
  variant?: "default" | "outline";
  children: React.ReactNode;
  testId: string;
}) {
  // onPress runs before the native submit event, so onSubmit can read the chosen intent
  const busy = pending && active;
  return (
    <Button type="submit" variant={variant} isPending={pending} onPress={() => { intentRef.current = intent; }} aria-busy={busy} data-testid={testId}>
      {busy && <Spinner />}
      {busy ? pendingLabel : children}
    </Button>
  );
}

type SlugCheck = { ok: boolean; reason?: string; suggestion?: string; pending?: boolean };

/** Debounced "is this slug free?" lookup; silent for the page's own current slug. */
function useSlugCheck(slug: string, pageId: string | null, currentSlug: string | null): SlugCheck | null {
  const [result, setResult] = useState<{ slug: string; check: SlugCheck } | null>(null);
  useEffect(() => {
    const clean = slugifyPage(slug);
    if (!clean || clean === currentSlug) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkPageSlug(clean, pageId).then((check) => {
        if (!cancelled) setResult({ slug: clean, check });
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, pageId, currentSlug]);
  const clean = slugifyPage(slug);
  if (!clean || clean === currentSlug) return null;
  if (result?.slug === clean) return result.check;
  return { ok: true, pending: true };
}
