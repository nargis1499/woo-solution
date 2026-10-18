"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { TruckIcon } from "lucide-react";
import { updateGeneralSettings, updateSeoSettings, updateShopSettings, type AdminFormState } from "@/app/nemesis/actions";
import {
  CURRENCIES,
  CURRENCY_CODES,
  USD_MONEY,
  formatExchangeRate,
  formatMoney,
  inputFromMicros,
  isCurrencyCode,
  moneyFromSettings,
  parseExchangeRate,
  parseMoneyInput,
  toBaseMicros,
  usdMicros,
  type CurrencyCode,
  type Money,
} from "@/lib/money";
import type { MediaRef, SiteSettings } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useFormToast } from "./flash-toast";
import { SubmitButton, SwitchField } from "./form-bits";
import { BRANDING_FOLDER, FAVICON_MIME_TYPES, SHARE_IMAGE_MIME_TYPES, brandingFileProblem } from "@/lib/media/shared";
import { MediaRefField } from "./media/media-ref-field";

/* One <form> per tab so each section saves independently; no helper text under
 * the inputs on purpose – the space is reserved for more options per tab. */

type Action = (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/** One settings form = one card with its own Server Action and Save button (also used by UI → Home page). */
export function SettingsCard({
  title,
  description,
  action,
  footer,
  children,
}: {
  title: string;
  description?: string;
  action: Action;
  /** Extra footer content next to the Save button, e.g. a preview link. */
  footer?: ReactNode;
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
        if (e.target !== e.currentTarget) return; // a form inside the (portalled) media picker, not this one
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-5">{children({ v: state?.values ?? {}, err: state?.fieldErrors ?? {} })}</FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3 border-t">
          <SubmitButton pendingLabel="Saving…" pending={isPending}>
            Save changes
          </SubmitButton>
          {footer}
        </CardFooter>
      </Card>
    </form>
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
      {({ v, err }) => <ShopSettingsBody settings={settings} v={v} err={err} />}
    </SettingsCard>
  );
}

function ShopSettingsBody({ settings, v, err }: { settings: SiteSettings; v: Record<string, string>; err: Record<string, string> }) {
  const [currency, setCurrency] = useState<CurrencyCode>(isCurrencyCode(v.currency) ? v.currency : settings.currency);
  const [rateText, setRateText] = useState<string>(
    v.usd_to_bdt_rate ?? (settings.usd_to_bdt_rate ? formatExchangeRate(settings.usd_to_bdt_rate) : ""),
  );

  const parsedRate = parseExchangeRate(rateText);
  const activeMoney: Money =
    currency === "BDT" && Number.isFinite(parsedRate) && parsedRate > 0
      ? { currency: "BDT", rate: parsedRate }
      : moneyFromSettings({ currency, usd_to_bdt_rate: settings.usd_to_bdt_rate });

  return (
    <FieldGroup className="gap-5">
      <SwitchField
        id="manage_stock"
        name="manage_stock"
        label="Manage stock – track quantities for all products and stop selling when they run out"
        defaultSelected={settings.manage_stock}
      />
      <FieldSeparator />
      <CurrencyFields
        currency={currency}
        onCurrencyChange={setCurrency}
        rateText={rateText}
        onRateTextChange={setRateText}
        err={err}
      />
      <FieldSeparator />
      <ShippingFields settings={settings} money={activeMoney} v={v} err={err} />
    </FieldGroup>
  );
}

/**
 * Store currency + the USD→BDT rate. Prices stay in USD in the database; the rate field
 * only exists while BDT is selected (a failed save keeps whatever was typed).
 */
function CurrencyFields({
  currency,
  onCurrencyChange,
  rateText,
  onRateTextChange,
  err,
}: {
  currency: CurrencyCode;
  onCurrencyChange: (next: CurrencyCode) => void;
  rateText: string;
  onRateTextChange: (next: string) => void;
  err: Record<string, string>;
}) {
  return (
    <FieldSet data-testid="currency-settings">
      <FieldLegend variant="label">Currency</FieldLegend>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="currency">Store currency</FieldLabel>
          <Select name="currency" selectedKey={currency} onSelectionChange={(key) => isCurrencyCode(key) && onCurrencyChange(key)} aria-label="Store currency">
            <SelectTrigger id="currency" className="w-full sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_CODES.map((code) => (
                <SelectItem key={code} id={code}>
                  {CURRENCIES[code].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {currency === "BDT" && (
          <Field data-invalid={Boolean(err.usd_to_bdt_rate) || undefined}>
            <FieldLabel htmlFor="usd_to_bdt_rate">Exchange rate</FieldLabel>
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>
                <InputGroupText>1 USD =</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="usd_to_bdt_rate"
                name="usd_to_bdt_rate"
                inputMode="decimal"
                placeholder="120"
                required
                value={rateText}
                onChange={(e) => onRateTextChange(e.target.value)}
                aria-invalid={Boolean(err.usd_to_bdt_rate) || undefined}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>BDT</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldError>{err.usd_to_bdt_rate}</FieldError>
          </Field>
        )}
      </FieldGroup>
    </FieldSet>
  );
}

const SHIPPING_PRESET_USD = [0, 5, 10, 15] as const;

function ShippingFields({
  settings,
  money,
  v,
  err,
}: {
  settings: SiteSettings;
  money: Money;
  v: Record<string, string>;
  err: Record<string, string>;
}) {
  const defaultEnabled = v.shipping_enabled ? v.shipping_enabled === "on" : settings.shipping_enabled;
  const [shippingEnabled, setShippingEnabled] = useState<boolean>(defaultEnabled);
  const [seenDefaultEnabled, setSeenDefaultEnabled] = useState<boolean>(settings.shipping_enabled);
  if (seenDefaultEnabled !== settings.shipping_enabled) {
    setSeenDefaultEnabled(settings.shipping_enabled);
    setShippingEnabled(settings.shipping_enabled);
  }

  const initialRateInput = inputFromMicros(settings.shipping_rate_micros, money);
  const [shippingRate, setShippingRate] = useState<string>(v.shipping_rate ?? initialRateInput);
  const [seenInitialRate, setSeenInitialRate] = useState<string>(initialRateInput);
  if (seenInitialRate !== initialRateInput) {
    setSeenInitialRate(initialRateInput);
    setShippingRate(initialRateInput);
  }

  const parsedMinor = parseMoneyInput(shippingRate);
  const previewMicros =
    parsedMinor !== null && !Number.isNaN(parsedMinor)
      ? toBaseMicros(parsedMinor, money)
      : settings.shipping_rate_micros;
  const previewLabel = !shippingEnabled
    ? "Disabled"
    : previewMicros === 0
      ? "Free"
      : formatMoney(previewMicros, money);

  return (
    <FieldSet data-testid="shipping-settings">
      <FieldLegend variant="label">Shipping options</FieldLegend>
      <div
        className={cn(
          "overflow-hidden rounded-xl border transition-colors",
          shippingEnabled ? "border-primary/30 bg-primary/[0.02]" : "border-border bg-muted/15",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
                shippingEnabled ? "bg-primary/15 text-primary ring-1 ring-primary/25" : "bg-muted text-muted-foreground",
              )}
            >
              <TruckIcon className="size-4" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="shipping_enabled" className="cursor-pointer text-sm font-medium leading-none">
                Enable shipping calculation
              </label>
              <Badge variant={shippingEnabled ? "default" : "secondary"} className="h-5 px-2 text-[11px] leading-none">
                {shippingEnabled ? "Enabled" : "Disabled"}
              </Badge>
              {shippingEnabled && (
                <Badge variant="outline" className="h-5 border-primary/30 bg-background px-2 text-[11px] font-semibold tabular-nums text-primary leading-none" data-testid="shipping-rate-preview">
                  {previewLabel}
                </Badge>
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 select-none">
            <input type="hidden" name="shipping_enabled" value={shippingEnabled ? "on" : "off"} />
            <Switch
              id="shipping_enabled"
              isSelected={shippingEnabled}
              onChange={setShippingEnabled}
              aria-label="Enable shipping calculation"
              data-testid="shipping-enabled-switch"
            />
          </label>
        </div>

        {shippingEnabled && (
          <div className="border-t border-border/70 bg-background/50 p-4" data-testid="shipping-rate-panel">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field data-invalid={Boolean(err.shipping_rate) || undefined}>
                <FieldLabel htmlFor="shipping_rate">Shipping rate</FieldLabel>
                <InputGroup className="sm:max-w-xs">
                  <InputGroupAddon>
                    <InputGroupText>{CURRENCIES[money.currency].symbol}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="shipping_rate"
                    name="shipping_rate"
                    inputMode="decimal"
                    placeholder="5.00"
                    required
                    value={shippingRate}
                    onChange={(e) => setShippingRate(e.target.value)}
                    aria-invalid={Boolean(err.shipping_rate) || undefined}
                    data-testid="shipping-rate-input"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{money.currency}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError>{err.shipping_rate}</FieldError>
              </Field>

              <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                {SHIPPING_PRESET_USD.map((usd) => {
                  const micros = usdMicros(usd);
                  const val = inputFromMicros(micros, money);
                  const active = shippingRate === val;
                  return (
                    <button
                      key={usd}
                      type="button"
                      onClick={() => setShippingRate(val)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium tabular-nums transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {usd === 0 ? "Free" : formatMoney(micros, money)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </FieldSet>
  );
}
