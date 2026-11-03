"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CalendarIcon,
  ExternalLinkIcon,
  EyeIcon,
  GlobeIcon,
  SaveIcon,
  UserIcon,
} from "lucide-react";
import {
  checkPageSlug,
  deletePage,
  savePage,
} from "@/app/nemesis/pages/actions";
import type { AdminFormState } from "@/lib/admin/form";
import { formatDate } from "@/lib/format";
import {
  PAGE_TITLE_MAX,
  featuredImage,
  pageHref,
  pagePreviewHref,
  shareImage,
  slugifyPage,
} from "@/lib/pages/shared";
import type { Page, Product } from "@/lib/types";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useFormToast } from "../flash-toast";
import { DeleteButton } from "../form-bits";
import { MediaRefField } from "../media/media-ref-field";
import {
  BlockEditorCanvas,
  BlockSettingsInspector,
  useBlockEditorState,
} from "./block-editor";
import { PageStatusBadge } from "./page-status-badge";
import { AiPageBuilder } from "./ai-page-builder";
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
  /** Simple products available for the "Simple Product" block. */
  simpleProducts?: Product[];
  /** Settings → SEO → site URL (null when unknown). */
  siteUrl: string | null;
  storeName: string;
  /** List URL (page / size / filter) to go back to. */
  returnTo?: string;
};

export function PageForm(props: PageFormProps) {
  const [state, dispatch, isPending] = useActionState<AdminFormState, FormData>(
    savePage,
    null,
  );
  useFormToast(state);
  // No remount key here on purpose: every field in this editor is controlled (title, slug, body,
  // tags, switches), so a save already redraws it from `state`/fresh props – while a remount would
  // slam the open SEO panel, the tag chips and the cursor shut on every save. The action state
  // lives in this wrapper so its toast is reported exactly once per result.
  return (
    <PageFields
      {...props}
      state={state}
      dispatch={dispatch}
      isPending={isPending}
    />
  );
}

function PageFields({
  page,
  tagSuggestions,
  simpleProducts = [],
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
  const [editorTab, setEditorTab] = useState<"blocks" | "settings">("blocks");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const featured = page ? featuredImage(page) : null;
  const [featuredPicked, setFeaturedPicked] = useState(Boolean(featured));
  const intentRef = useRef<Intent>(isPublished ? "update" : "draft");
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
    if (state?.fieldErrors?.content) setEditorTab("blocks");
    else if (
      state?.fieldErrors &&
      Object.keys(state.fieldErrors).some((key) =>
        /^(seo_|og_|canonical_|robots_|tags)/.test(key),
      )
    )
      setEditorTab("settings");
  }
  useUnsavedChanges(dirty && !isPending);

  // ── live slug availability ────────────────────────────────────────────────
  const slugCheck = useSlugCheck(slug, page?.id ?? null, page?.slug ?? null);
  const slugError =
    err.slug ??
    (slugCheck && !slugCheck.ok
      ? `${slugCheck.reason}${slugCheck.suggestion ? ` Try "/${slugCheck.suggestion}".` : ""}`
      : undefined);

  return (
    <form
      noValidate
      className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]"
      data-testid="page-form"
      // Events from portalled dialogs (media picker) bubble through the React tree:
      // only react to the page form's own fields / its own submit.
      onChange={(e) => {
        if (
          e.currentTarget.contains(e.target as Node) &&
          !(e.target as HTMLElement).closest("[data-ai-builder]")
        )
          setDirty(true);
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

      <header
        className="col-span-full flex flex-wrap items-end justify-between gap-4"
        data-testid="page-editor-header"
      >
        <div className="min-w-0 space-y-2">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <a href={returnTo} className="hover:text-foreground">
              Pages
            </a>
            <span aria-hidden>/</span>
            <span className="max-w-64 truncate">
              {title || "Untitled page"}
            </span>
          </nav>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {isEdit ? "Edit page" : "New page"}
            </h1>
            <PageStatusBadge status={page?.status ?? "draft"} />
          </div>
          {dirty && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400"
              data-testid="unsaved-hint"
            >
              Unsaved changes
            </p>
          )}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="publish-card"
        >
          <LinkButton href={returnTo} variant="ghost" size="sm">
            Cancel
          </LinkButton>
          {page ? (
            <LinkButton
              href={pagePreviewHref(page.id)}
              target="_blank"
              variant="outline"
              size="sm"
              data-testid="preview-link"
            >
              <EyeIcon />
              Preview
            </LinkButton>
          ) : (
            <span className="text-xs text-muted-foreground">
              Save to preview
            </span>
          )}
          {isPublished ? (
            <>
              <IntentButton
                intent="update"
                intentRef={intentRef}
                pending={isPending}
                active={submitted === "update"}
                pendingLabel="Saving…"
                testId="save-update"
              >
                <SaveIcon />
                Update
              </IntentButton>
              <IntentButton
                intent="unpublish"
                intentRef={intentRef}
                pending={isPending}
                active={submitted === "unpublish"}
                variant="outline"
                pendingLabel="Saving…"
                testId="save-unpublish"
              >
                Unpublish
              </IntentButton>
            </>
          ) : (
            <>
              <IntentButton
                intent="draft"
                intentRef={intentRef}
                pending={isPending}
                active={submitted === "draft"}
                pendingLabel="Saving…"
                testId="save-draft"
              >
                <SaveIcon />
                Save draft
              </IntentButton>
              <IntentButton
                intent="publish"
                intentRef={intentRef}
                pending={isPending}
                active={submitted === "publish"}
                variant="outline"
                pendingLabel="Publishing…"
                testId="save-publish"
              >
                Publish
              </IntentButton>
            </>
          )}
        </div>
      </header>

      <div className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs">
        <div className="grid items-start gap-4 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_190px]">
          <Field data-invalid={Boolean(err.title) || undefined}>
            <FieldLabel htmlFor="title" className="text-xs">
              Page title
            </FieldLabel>
            <Input
              id="title"
              name="title"
              required
              maxLength={PAGE_TITLE_MAX}
              value={title}
              placeholder="About us"
              className="text-sm font-medium"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugifyPage(e.target.value));
              }}
              aria-invalid={Boolean(err.title) || undefined}
            />
            <FieldError>{err.title}</FieldError>
          </Field>

          <Field data-invalid={Boolean(slugError) || undefined}>
            <FieldLabel htmlFor="slug" className="text-xs">
              Slug
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText
                  className="max-w-16 truncate text-xs"
                  title={siteUrl ?? undefined}
                >
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
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => {
                        setSlugTouched(true);
                        setSlug(slugCheck.suggestion!);
                      }}
                    >
                      Use it
                    </button>
                  </>
                )}
              </FieldError>
            ) : (
              <FieldDescription id="slug-hint">
                {isEdit && page?.slug !== slug && slug ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Changing the slug changes the public URL – old links will
                    stop working.
                  </span>
                ) : (
                  <>
                    Public address:{" "}
                    <span className="font-mono">
                      {pageHref(slug || "about-us")}
                    </span>
                  </>
                )}
              </FieldDescription>
            )}
          </Field>

          <div className="sm:col-span-2 xl:col-span-1">
            <MediaRefField
              compact
              name="featured_image"
              label="Featured image"
              shape="wide"
              currentUrl={featured?.src ?? null}
              currentMedia={featured?.media ?? null}
              error={err.featured_image_media_id ?? err.featured_image_url}
              allowUrl
              onChange={(has) => {
                setFeaturedPicked(has);
                setDirty(true);
              }}
              picker={{
                kind: "image",
                title: "Featured image",
                description:
                  "Select or upload a featured image. Its library alt text is used on the page.",
                confirmLabel: "Use as featured image",
              }}
            />
          </div>
        </div>
        <div
          className="flex gap-6 border-b border-border px-4"
          role="tablist"
          aria-label="Page editor"
        >
          {(
            [
              ["blocks", "Blocks"],
              ["settings", "Page settings"],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              id={`page-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={editorTab === tab}
              aria-controls={`page-panel-${tab}`}
              tabIndex={editorTab === tab ? 0 : -1}
              onClick={() => setEditorTab(tab)}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? "blocks"
                      : e.key === "End"
                        ? "settings"
                        : tab === "blocks"
                          ? "settings"
                          : "blocks";
                  setEditorTab(next);
                  document.getElementById(`page-tab-${next}`)?.focus();
                }
              }}
              className={cn(
                "-mb-px border-b-2 py-3 text-xs font-semibold transition-colors",
                editorTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="page-panel-blocks"
          role="tabpanel"
          aria-labelledby="page-tab-blocks"
          hidden={editorTab !== "blocks"}
          className="p-3 sm:p-4"
        >
          <BlockEditorCanvas
            controller={blockController}
            simpleProducts={simpleProducts}
            onFocusInspector={() => setInspectorOpen(true)}
            name="content"
            invalid={Boolean(err.content)}
            presentation="sections"
          />
          <FieldError>{err.content}</FieldError>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Select Edit to change content, or drag a section handle to reorder.
            Visual summaries simplify inline formatting; use Preview after
            saving to see the full storefront.
          </p>
        </div>
        <div
          id="page-panel-settings"
          role="tabpanel"
          aria-labelledby="page-tab-settings"
          hidden={editorTab !== "settings"}
          className="space-y-5 p-4"
        >
          <div className="space-y-2">
            <FieldLabel htmlFor="tags">Tags</FieldLabel>
            <TagInput
              id="tags"
              name="tags"
              suggestions={tagSuggestions}
              defaultValue={
                v.tags
                  ? v.tags.split("\n")
                  : (page?.tags ?? []).map((t) => t.name)
              }
              onChange={() => setDirty(true)}
            />
            <FieldError>{err.tags}</FieldError>
          </div>
          <SeoSettings
            values={{
              seo_title: v.seo_title ?? page?.seo_title ?? "",
              seo_description: v.seo_description ?? page?.seo_description ?? "",
              canonical_url: v.canonical_url ?? page?.canonical_url ?? "",
              robots_index: v.robots_index
                ? v.robots_index !== "off"
                : (page?.robots_index ?? true),
              robots_follow: v.robots_follow
                ? v.robots_follow !== "off"
                : (page?.robots_follow ?? true),
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
            defaultOpen={false}
          />
          {page && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Page details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-xs text-muted-foreground">
                  {page.author && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="size-3.5" />
                      <dt>Author</dt>
                      <dd>
                        {page.author.full_name ||
                          page.author.email ||
                          "Unknown"}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="size-3.5" />
                    <dt>Updated</dt>
                    <dd>{formatDate(page.updated_at)}</dd>
                  </div>
                  {page.published_at && isPublished && (
                    <div className="flex items-center gap-2">
                      <GlobeIcon className="size-3.5" />
                      <dt>Published</dt>
                      <dd>{formatDate(page.published_at)}</dd>
                    </div>
                  )}
                </dl>
                {isPublished && (
                  <LinkButton
                    href={pageHref(page.slug)}
                    target="_blank"
                    variant="outline"
                    size="sm"
                    data-testid="view-live-link"
                  >
                    <ExternalLinkIcon />
                    View live page
                  </LinkButton>
                )}
                <div className="mt-3 border-t border-border pt-3">
                  <DeleteButton
                    action={deletePage}
                    id={page.id}
                    returnTo={returnTo}
                    label="Delete page"
                    size="default"
                    title={`Delete "${page.title}"?`}
                    description={`The page and its public URL /${page.slug} are removed permanently. This cannot be undone.`}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <aside
        className="min-w-0 space-y-4 self-start lg:sticky lg:top-16"
        aria-label="Page design tools"
      >
        <AiPageBuilder
          controller={blockController}
          title={title}
          disabled={isPending}
        />
        <details
          open={inspectorOpen}
          onToggle={(e) => setInspectorOpen(e.currentTarget.open)}
          data-testid="inspector-card"
          className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs"
        >
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold">
            Block settings{" "}
            <span className="ml-1 font-normal text-muted-foreground">
              · Selected block
            </span>
          </summary>
          <div className="border-t border-border">
            <BlockSettingsInspector
              controller={blockController}
              simpleProducts={simpleProducts}
            />
          </div>
        </details>
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
    <Button
      type="submit"
      variant={variant}
      size="sm"
      isPending={pending}
      onPress={() => {
        intentRef.current = intent;
      }}
      aria-busy={busy}
      data-testid={testId}
    >
      {busy && <Spinner />}
      {busy ? pendingLabel : children}
    </Button>
  );
}

type SlugCheck = {
  ok: boolean;
  reason?: string;
  suggestion?: string;
  pending?: boolean;
};

/** Debounced "is this slug free?" lookup; silent for the page's own current slug. */
function useSlugCheck(
  slug: string,
  pageId: string | null,
  currentSlug: string | null,
): SlugCheck | null {
  const [result, setResult] = useState<{
    slug: string;
    check: SlugCheck;
  } | null>(null);
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
