"use client";

import { useState } from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_RECOMMENDED, SEO_TITLE_MAX, SEO_TITLE_RECOMMENDED, excerptFromHtml, pageHref, truncate } from "@/lib/pages/shared";
import type { MediaRef } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SwitchField } from "@/components/admin/form-bits";
import { MediaRefField } from "@/components/admin/media/media-ref-field";
import { BRANDING_FOLDER, SHARE_IMAGE_MIME_TYPES, brandingFileProblem, mediaUrl } from "@/lib/media/shared";

/*
 * Expandable "Search & social" section of the page form. Every field is
 * optional – the preview shows what search engines and social networks get
 * when the fields are empty (title / content / featured image). They treat all
 * of this as hints, not instructions.
 */

export type SeoValues = {
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  robots_index: boolean;
  robots_follow: boolean;
  og_title: string;
  og_description: string;
};

export function SeoSettings({
  values,
  errors,
  pageTitle,
  slug,
  contentHtml,
  siteUrl,
  storeName,
  ogImage,
  hasFeaturedImage,
  defaultOpen,
}: {
  values: SeoValues;
  errors: Record<string, string>;
  /** Live values from the rest of the form – drive the defaults in the preview. */
  pageTitle: string;
  slug: string;
  contentHtml: string;
  /** Settings → SEO → site URL (null when unknown). */
  siteUrl: string | null;
  storeName: string;
  /** Stored share image (edit mode). */
  ogImage: MediaRef | null;
  hasFeaturedImage: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [seoTitle, setSeoTitle] = useState(values.seo_title);
  const [seoDescription, setSeoDescription] = useState(values.seo_description);

  const previewTitle = seoTitle.trim() || pageTitle.trim() || "Page title";
  const previewDescription = seoDescription.trim() || excerptFromHtml(contentHtml) || "The first sentences of the page content are shown here when no meta description is set.";
  const host = siteUrl ? siteUrl.replace(/^https?:\/\//, "") : "your-site.com";

  return (
    <Collapsible isExpanded={open} onExpandedChange={setOpen}>
      <Card className="gap-0 py-0" data-testid="seo-settings">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl px-6 py-5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="seo-toggle">
          <CardHeader className="w-full p-0">
            <CardTitle className="flex items-center gap-2">
              <SearchIcon className="size-4 text-muted-foreground" /> Search &amp; social
            </CardTitle>
            <CardDescription>Meta title, description, canonical URL, robots and Open Graph tags. Everything is optional – sensible defaults come from the page itself.</CardDescription>
          </CardHeader>
          <ChevronDownIcon className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="border-t pt-6 pb-6">
            <FieldGroup className="gap-5">
              {/* ── search preview ─────────────────────────────────────── */}
              <div className="rounded-lg border bg-muted/30 p-4" data-testid="seo-preview">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Search result preview</p>
                <div className="font-sans">
                  <p className="truncate text-xs text-muted-foreground">
                    {host} › {slug || "page-slug"}
                  </p>
                  <p className="truncate text-lg text-[#1a0dab] dark:text-[#8ab4f8]" data-testid="seo-preview-title">
                    {truncate(previewTitle, SEO_TITLE_RECOMMENDED + 10)}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground" data-testid="seo-preview-description">
                    {truncate(previewDescription, SEO_DESCRIPTION_RECOMMENDED + 20)}
                  </p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">An approximation – search engines decide what they actually show.</p>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Field data-invalid={Boolean(errors.seo_title) || undefined}>
                  <FieldLabel htmlFor="seo_title">SEO title</FieldLabel>
                  <Input id="seo_title" name="seo_title" value={seoTitle} maxLength={SEO_TITLE_MAX} placeholder={pageTitle || "Defaults to the page title"} onChange={(e) => setSeoTitle(e.target.value)} aria-invalid={Boolean(errors.seo_title) || undefined} />
                  <Counter value={seoTitle.length} recommended={SEO_TITLE_RECOMMENDED} />
                  <FieldError>{errors.seo_title}</FieldError>
                </Field>
                <Field data-invalid={Boolean(errors.canonical_url) || undefined}>
                  <FieldLabel htmlFor="canonical_url">Canonical URL</FieldLabel>
                  <Input id="canonical_url" name="canonical_url" type="url" inputMode="url" defaultValue={values.canonical_url} placeholder={siteUrl ? `${siteUrl}${pageHref(slug || "page-slug")}` : "https://…"} aria-invalid={Boolean(errors.canonical_url) || undefined} />
                  <FieldDescription>Only when this content lives at another address too.</FieldDescription>
                  <FieldError>{errors.canonical_url}</FieldError>
                </Field>
              </div>

              <Field data-invalid={Boolean(errors.seo_description) || undefined}>
                <FieldLabel htmlFor="seo_description">Meta description</FieldLabel>
                <Textarea id="seo_description" name="seo_description" rows={3} value={seoDescription} maxLength={SEO_DESCRIPTION_MAX} placeholder="Defaults to the beginning of the content" onChange={(e) => setSeoDescription(e.target.value)} aria-invalid={Boolean(errors.seo_description) || undefined} />
                <Counter value={seoDescription.length} recommended={SEO_DESCRIPTION_RECOMMENDED} />
                <FieldError>{errors.seo_description}</FieldError>
              </Field>

              <div className="grid gap-2 sm:grid-cols-2">
                <SwitchField id="robots_index" name="robots_index" label="Allow search engines to index this page" defaultSelected={values.robots_index} />
                <SwitchField id="robots_follow" name="robots_follow" label="Allow search engines to follow its links" defaultSelected={values.robots_follow} />
              </div>

              {/* ── Open Graph ─────────────────────────────────────────── */}
              <div className="grid gap-5 border-t pt-5 lg:grid-cols-2">
                <Field data-invalid={Boolean(errors.og_title) || undefined}>
                  <FieldLabel htmlFor="og_title">Social title</FieldLabel>
                  <Input id="og_title" name="og_title" defaultValue={values.og_title} maxLength={SEO_TITLE_MAX} placeholder={seoTitle || pageTitle || "Defaults to the SEO title"} aria-invalid={Boolean(errors.og_title) || undefined} />
                  <FieldError>{errors.og_title}</FieldError>
                </Field>
                <Field data-invalid={Boolean(errors.og_description) || undefined}>
                  <FieldLabel htmlFor="og_description">Social description</FieldLabel>
                  <Input id="og_description" name="og_description" defaultValue={values.og_description} maxLength={SEO_DESCRIPTION_MAX} placeholder="Defaults to the meta description" aria-invalid={Boolean(errors.og_description) || undefined} />
                  <FieldError>{errors.og_description}</FieldError>
                </Field>
              </div>
              <MediaRefField
                name="og_image"
                label="Social share image"
                shape="wide"
                currentUrl={ogImage ? mediaUrl(ogImage.path) : null}
                currentMedia={ogImage}
                error={errors.og_image_media_id}
                chooseLabel={hasFeaturedImage ? "Use a different image" : "Choose image"}
                picker={{
                  kind: "image",
                  accept: SHARE_IMAGE_MIME_TYPES.join(","),
                  acceptFile: (file) => brandingFileProblem(file, "share_image"),
                  uploadFolderName: BRANDING_FOLDER,
                  title: "Social share image",
                  description: "Shown when the page is shared on social networks (1200 × 630 works best). Leave empty to use the featured image.",
                  confirmLabel: "Use as share image",
                }}
              />
              {!ogImage && <p className="-mt-3 text-xs text-muted-foreground">{hasFeaturedImage ? "The featured image is used until you choose a different one." : `Falls back to the featured image, then to the site-wide share image of ${storeName}.`}</p>}
            </FieldGroup>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function Counter({ value, recommended }: { value: number; recommended: number }) {
  const over = value > recommended;
  return (
    <p className={cn("text-xs tabular-nums", over ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} aria-live="polite">
      {value} / {recommended} characters{over && " – longer text may be cut off"}
    </p>
  );
}
