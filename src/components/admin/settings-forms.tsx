"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { updateGeneralSettings, updateSeoSettings, updateShopSettings, type AdminFormState } from "@/app/nemesis/actions";
import type { MediaRef, SiteSettings } from "@/lib/types";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";
import { BRANDING_FOLDER, FAVICON_MIME_TYPES, SHARE_IMAGE_MIME_TYPES, brandingFileProblem } from "@/lib/media/shared";
import { MediaRefField } from "./media/media-ref-field";

/* One <form> per tab so each section saves independently; no helper text under
 * the inputs on purpose – the space is reserved for more options per tab. */

type Action = (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;

function SettingsCard({
  title,
  action,
  children,
}: {
  title: string;
  action: Action;
  children: (ctx: { v: Record<string, string>; err: Record<string, string> }) => ReactNode;
}) {
  const [state, dispatch, isPending] = useActionState<AdminFormState, FormData>(action, null);
  useFormToast(state);
  return (
    // Dispatched from onSubmit instead of `<form action>` on purpose: React 19 resets a form after an
    // `action` completes, which flips React Aria's switch/checkbox inputs back to their initial DOM
    // state and makes the next click look dead. Without the reset what you see is what gets saved.
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-5">{children({ v: state?.values ?? {}, err: state?.fieldErrors ?? {} })}</FieldGroup>
        </CardContent>
        <CardFooter className="border-t">
          <SubmitButton pendingLabel="Saving…" pending={isPending}>
            Save changes
          </SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}

/**
 * Labelled switch. The value travels in a hidden input driven by React state
 * (not the switch's own checkbox), so what is shown is always what gets
 * submitted. When the server value changes underneath (saved elsewhere, page
 * refreshed) the switch follows it.
 */
function SwitchField({ id, name, label, defaultSelected }: { id: string; name: string; label: string; defaultSelected: boolean }) {
  const [selected, setSelected] = useState(defaultSelected);
  const [seenDefault, setSeenDefault] = useState(defaultSelected);
  if (seenDefault !== defaultSelected) {
    // derived-state reset during render (React-sanctioned pattern, no effect needed)
    setSeenDefault(defaultSelected);
    setSelected(defaultSelected);
  }
  return (
    <FieldLabel htmlFor={id} className="items-center gap-3 py-1 text-sm font-medium has-data-selected:bg-transparent">
      <input type="hidden" name={name} value={selected ? "on" : "off"} />
      <Switch id={id} isSelected={selected} onChange={setSelected} />
      {label}
    </FieldLabel>
  );
}

const invalid = (message?: string) => (message ? { "data-invalid": true as const } : {});

/* ── General ─────────────────────────────────────────────────────────────── */

export function GeneralSettingsForm({ settings, favicon }: { settings: SiteSettings; favicon: MediaRef | null }) {
  return (
    <SettingsCard title="General" action={updateGeneralSettings}>
      {({ v, err }) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field {...invalid(err.store_name)}>
              <FieldLabel htmlFor="store_name">Site title</FieldLabel>
              <Input id="store_name" name="store_name" required maxLength={60} defaultValue={v.store_name ?? settings.store_name} aria-invalid={Boolean(err.store_name) || undefined} />
              <FieldError>{err.store_name}</FieldError>
            </Field>
            <Field {...invalid(err.support_email)}>
              <FieldLabel htmlFor="support_email">Support e-mail</FieldLabel>
              <Input id="support_email" name="support_email" type="email" maxLength={120} placeholder="help@example.com" defaultValue={v.support_email ?? settings.support_email ?? ""} aria-invalid={Boolean(err.support_email) || undefined} />
              <FieldError>{err.support_email}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="tagline">Tagline</FieldLabel>
            <Input id="tagline" name="tagline" maxLength={160} placeholder="A modern storefront built with Next.js and Supabase." defaultValue={v.tagline ?? settings.tagline ?? ""} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field {...invalid(err.whatsapp)}>
              <FieldLabel htmlFor="whatsapp">WhatsApp number</FieldLabel>
              <Input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" maxLength={40} placeholder="+880 1700 000000" defaultValue={v.whatsapp ?? (settings.whatsapp ? `+${settings.whatsapp}` : "")} aria-invalid={Boolean(err.whatsapp) || undefined} />
              <FieldError>{err.whatsapp}</FieldError>
            </Field>
            <Field {...invalid(err.telegram)}>
              <FieldLabel htmlFor="telegram">Telegram username</FieldLabel>
              <Input id="telegram" name="telegram" maxLength={120} placeholder="@yourstore" defaultValue={v.telegram ?? (settings.telegram ? `@${settings.telegram}` : "")} aria-invalid={Boolean(err.telegram) || undefined} />
              <FieldError>{err.telegram}</FieldError>
            </Field>
          </div>
          <MediaRefField
            name="favicon"
            label="Favicon"
            currentUrl={settings.favicon_url}
            currentMedia={favicon}
            error={err.favicon_media_id}
            picker={{
              title: "Favicon",
              description: "Pick an icon from the Media Library or upload a new one (ICO, PNG, SVG or WebP – square, at least 32 × 32).",
              confirmLabel: "Use as favicon",
              accept: `.ico,${FAVICON_MIME_TYPES.join(",")}`,
              acceptFile: (file) => brandingFileProblem(file, "favicon"),
              uploadFolderName: BRANDING_FOLDER,
            }}
            chooseLabel="Choose icon"
            removeLabel="Use the default icon"
          />
        </>
      )}
    </SettingsCard>
  );
}

/* ── SEO ─────────────────────────────────────────────────────────────────── */

const DESCRIPTION_IDEAL = 160;

export function SeoSettingsForm({ settings, shareImage }: { settings: SiteSettings; shareImage: MediaRef | null }) {
  const [descriptionLength, setDescriptionLength] = useState((settings.seo_description ?? "").length);

  return (
    <SettingsCard title="SEO" action={updateSeoSettings}>
      {({ v, err }) => (
        <>
          <SwitchField id="seo_indexing" name="seo_indexing" label="Search engine visibility – allow search engines to index this site" defaultSelected={settings.seo_indexing} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field {...invalid(err.seo_site_url)}>
              <FieldLabel htmlFor="seo_site_url">Site URL</FieldLabel>
              <Input id="seo_site_url" name="seo_site_url" type="url" inputMode="url" maxLength={200} placeholder="https://www.example.com" defaultValue={v.seo_site_url ?? settings.seo_site_url ?? ""} aria-invalid={Boolean(err.seo_site_url) || undefined} />
              <FieldError>{err.seo_site_url}</FieldError>
            </Field>
            <Field {...invalid(err.seo_twitter)}>
              <FieldLabel htmlFor="seo_twitter">X / Twitter handle</FieldLabel>
              <Input id="seo_twitter" name="seo_twitter" maxLength={120} placeholder="@yourstore" defaultValue={v.seo_twitter ?? (settings.seo_twitter ? `@${settings.seo_twitter}` : "")} aria-invalid={Boolean(err.seo_twitter) || undefined} />
              <FieldError>{err.seo_twitter}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="seo_title">Home page title</FieldLabel>
            <Input id="seo_title" name="seo_title" maxLength={100} placeholder={settings.store_name} defaultValue={v.seo_title ?? settings.seo_title ?? ""} />
          </Field>
          <Field>
            <div className="flex items-end justify-between gap-3">
              <FieldLabel htmlFor="seo_description">Meta description</FieldLabel>
              <span className={`text-xs tabular-nums ${descriptionLength > DESCRIPTION_IDEAL ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} aria-live="polite">
                {descriptionLength}/{DESCRIPTION_IDEAL}
              </span>
            </div>
            <Textarea
              id="seo_description"
              name="seo_description"
              rows={3}
              maxLength={320}
              placeholder={settings.tagline ?? "What the store sells, for whom and why – shown under the title in search results."}
              defaultValue={v.seo_description ?? settings.seo_description ?? ""}
              onChange={(e) => setDescriptionLength(e.target.value.length)}
            />
          </Field>
          <MediaRefField
            name="share_image"
            label="Social share image (Open Graph · 1200 × 630)"
            currentUrl={settings.seo_og_image_url}
            currentMedia={shareImage}
            error={err.share_image_media_id}
            shape="wide"
            picker={{
              title: "Social share image",
              description: "Shown when a page is shared on social networks – JPEG, PNG, WebP or GIF, ideally 1200 × 630.",
              confirmLabel: "Use as share image",
              accept: SHARE_IMAGE_MIME_TYPES.join(","),
              acceptFile: (file) => brandingFileProblem(file, "share_image"),
              uploadFolderName: BRANDING_FOLDER,
            }}
            removeLabel="Remove the share image"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field {...invalid(err.seo_google_verification)}>
              <FieldLabel htmlFor="seo_google_verification">Google Search Console verification code</FieldLabel>
              <Input id="seo_google_verification" name="seo_google_verification" maxLength={300} autoComplete="off" spellCheck={false} placeholder="google-site-verification content" defaultValue={v.seo_google_verification ?? settings.seo_google_verification ?? ""} aria-invalid={Boolean(err.seo_google_verification) || undefined} />
              <FieldError>{err.seo_google_verification}</FieldError>
            </Field>
            <Field {...invalid(err.seo_bing_verification)}>
              <FieldLabel htmlFor="seo_bing_verification">Bing Webmaster verification code</FieldLabel>
              <Input id="seo_bing_verification" name="seo_bing_verification" maxLength={300} autoComplete="off" spellCheck={false} placeholder="msvalidate.01 content" defaultValue={v.seo_bing_verification ?? settings.seo_bing_verification ?? ""} aria-invalid={Boolean(err.seo_bing_verification) || undefined} />
              <FieldError>{err.seo_bing_verification}</FieldError>
            </Field>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

/* ── WooCommerce ─────────────────────────────────────────────────────────── */

export function ShopSettingsForm({ settings }: { settings: SiteSettings }) {
  return (
    <SettingsCard title="WooCommerce" action={updateShopSettings}>
      {() => <SwitchField id="manage_stock" name="manage_stock" label="Manage stock – track quantities for all products and stop selling when they run out" defaultSelected={settings.manage_stock} />}
    </SettingsCard>
  );
}
