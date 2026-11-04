"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlugZapIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { saveStripeSettings, testStripeConnection } from "@/app/nemesis/stripe-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  STRIPE_SNAPSHOT_EVENT_TYPES,
  STRIPE_THIN_EVENT_TYPES,
  STRIPE_WEBHOOK_PATH,
  isValidStripePublishableKey,
  isValidStripeSecretKey,
  isValidStripeWebhookSecret,
  stripeKeyMode,
  type StripeAdminSummary,
} from "@/lib/stripe";
import { cn } from "@/lib/utils";

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function ReadinessItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
          done
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        {done ? <CheckIcon className="size-3" /> : <AlertTriangleIcon className="size-3" />}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </li>
  );
}

export function StripePaymentSettings({
  initialSummary,
  siteUrl,
}: {
  initialSummary: StripeAdminSummary;
  siteUrl?: string | null;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [enabled, setEnabled] = useState(initialSummary.enabled);
  const [expanded, setExpanded] = useState(false);
  const [publishableKey, setPublishableKey] = useState(initialSummary.publishableKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [clearSecretKey, setClearSecretKey] = useState(false);
  const [clearWebhookSecret, setClearWebhookSecret] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const configuredOrigin = originFromUrl(siteUrl);
  const browserOrigin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => configuredOrigin ?? "https://your-store.com",
  );
  const origin = configuredOrigin ?? browserOrigin;

  const webhookUrl = `${origin}${STRIPE_WEBHOOK_PATH}`;
  const enteredSecretValid = isValidStripeSecretKey(secretKey);
  const enteredWebhookValid = isValidStripeWebhookSecret(webhookSecret);
  const hasEffectiveSecret = Boolean(
    enteredSecretValid || (summary.hasSecretKey && !(clearSecretKey && summary.secretSource === "database")),
  );
  const hasEffectiveWebhook = Boolean(
    enteredWebhookValid ||
      (summary.hasWebhookSecret && !(clearWebhookSecret && summary.webhookSource === "database")),
  );
  const publishableMode = stripeKeyMode(publishableKey);
  const secretMode = stripeKeyMode(secretKey) ?? summary.mode;
  const effectiveMode = secretMode ?? publishableMode;
  const modesMatch = !publishableMode || !secretMode || publishableMode === secretMode;
  const ready = Boolean(
    summary.migrated &&
      summary.serviceRoleConfigured &&
      hasEffectiveSecret &&
      hasEffectiveWebhook &&
      modesMatch,
  );

  function persist(nextEnabled: boolean) {
    startTransition(async () => {
      const result = await saveStripeSettings({
        enabled: nextEnabled,
        publishableKey,
        secretKey,
        webhookSecret,
        clearSecretKey,
        clearWebhookSecret,
      });
      if (!result.ok) {
        setEnabled(summary.enabled);
        toast.error(result.error);
        return;
      }
      setSummary(result.summary);
      setEnabled(result.summary.enabled);
      setPublishableKey(result.summary.publishableKey ?? "");
      setSecretKey("");
      setWebhookSecret("");
      setClearSecretKey(false);
      setClearWebhookSecret(false);
      toast.success(result.message);
      router.refresh();
    });
  }

  function handleToggle(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    if (nextEnabled) setExpanded(true);
    persist(nextEnabled);
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      const result = await testStripeConnection({ secretKey });
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    } catch {
      toast.error("Could not reach Stripe. Check the key and try again.");
    } finally {
      setTesting(false);
    }
  }

  async function handleCopyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      toast.success("Stripe webhook URL copied to clipboard!");
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      toast.error("Could not copy automatically — please copy the URL manually.");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid="payment-stripe-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-testid="payment-stripe-header"
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors select-none hover:bg-muted/30"
      >
        <div className="flex items-center gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-500">
            <CreditCardIcon className="size-5" aria-hidden />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                Stripe Checkout (Cards &amp; Wallets)
              </h2>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                  enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground",
                )}
              >
                {enabled ? "Enabled" : "Disabled"}
              </span>
              <span
                data-testid="payment-stripe-mode-badge"
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                  effectiveMode === "live"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : effectiveMode === "test"
                      ? "border border-amber-500/35 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {effectiveMode === "live" ? "Live mode" : effectiveMode === "test" ? "Test mode" : "Not configured"}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  ready
                    ? "border border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {ready ? "Webhook ready" : "Setup needed"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Stripe-hosted secure checkout. Card details never touch this store.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Switch
            aria-label="Enable Stripe Checkout"
            isSelected={enabled}
            isDisabled={isPending}
            onChange={handleToggle}
            data-testid="payment-stripe-switch"
          />
          <button
            type="button"
            aria-label={expanded ? "Collapse Stripe Checkout" : "Expand Stripe Checkout"}
            onClick={() => setExpanded((prev) => !prev)}
            className="grid size-8 cursor-pointer place-items-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDownIcon className={cn("size-4 transition-transform duration-200", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-5 border-t bg-muted/10 p-6" data-testid="payment-stripe-body">
          {summary.serviceRoleConfigured && !summary.migrated && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Database update required</AlertTitle>
              <AlertDescription>
                Run <code>supabase/migrations/20261063000000_stripe_checkout.sql</code> in Supabase before saving
                Stripe credentials.
              </AlertDescription>
            </Alert>
          )}
          {!summary.serviceRoleConfigured && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Server key required</AlertTitle>
              <AlertDescription>
                Set <code>SUPABASE_SERVICE_ROLE_KEY</code> in the deployment environment. Stripe secrets are stored
                in a private table that only the server can read.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-xl border bg-background/70 p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheckIcon className="size-4 text-violet-500" aria-hidden />
                <h3 className="text-xs font-bold tracking-wider uppercase">Setup checklist</h3>
              </div>
              <ul className="space-y-2.5">
                <ReadinessItem done={hasEffectiveSecret}>
                  Stripe secret/restricted key {summary.secretKeyLast4 ? `(saved ••••${summary.secretKeyLast4})` : "added"}
                </ReadinessItem>
                <ReadinessItem done={hasEffectiveWebhook}>
                  Webhook signing secret {summary.webhookSecretLast4 ? `(saved ••••${summary.webhookSecretLast4})` : "added"}
                </ReadinessItem>
                <ReadinessItem done={Boolean(effectiveMode)}>
                  {effectiveMode ? `${effectiveMode === "test" ? "Test" : "Live"} keys selected` : "Choose test keys first, then switch to live keys"}
                </ReadinessItem>
                <ReadinessItem done={modesMatch}>Publishable and server keys use the same mode</ReadinessItem>
                <ReadinessItem done={summary.migrated && summary.serviceRoleConfigured}>
                  Private server storage is ready
                </ReadinessItem>
              </ul>
              <div className="mt-4 rounded-lg bg-violet-500/[0.07] p-3 text-xs leading-relaxed text-muted-foreground">
                <LockKeyholeIcon className="mr-1.5 inline size-3.5 text-violet-500" aria-hidden />
                Saved secrets are write-only here: after saving, this page shows only the last four characters.
              </div>
            </div>

            <form
              className="rounded-xl border bg-background/70 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                persist(enabled);
              }}
            >
              <div className="mb-4 flex items-center gap-2">
                <KeyRoundIcon className="size-4 text-violet-500" aria-hidden />
                <h3 className="text-xs font-bold tracking-wider uppercase">Stripe API keys</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="stripe-publishable-key">Publishable key <span className="font-normal text-muted-foreground">(recommended)</span></Label>
                  <Input
                    id="stripe-publishable-key"
                    value={publishableKey}
                    onChange={(e) => setPublishableKey(e.target.value)}
                    placeholder="pk_test_… or pk_live_…"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                    data-testid="stripe-publishable-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Hosted Checkout does not expose this key in the browser; it is used to catch test/live mismatches.
                  </p>
                  {publishableKey && !isValidStripePublishableKey(publishableKey) && (
                    <p className="text-xs font-medium text-destructive">This should start with pk_test_ or pk_live_.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="stripe-secret-key">Secret or restricted key *</Label>
                    {summary.hasSecretKey && summary.secretSource === "database" && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => {
                          setClearSecretKey((prev) => !prev);
                          setSecretKey("");
                        }}
                      >
                        {clearSecretKey ? "Undo removal" : "Remove saved key"}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="stripe-secret-key"
                      type={showSecretKey ? "text" : "password"}
                      value={secretKey}
                      onChange={(e) => {
                        setSecretKey(e.target.value);
                        if (e.target.value) setClearSecretKey(false);
                      }}
                      placeholder={
                        clearSecretKey
                          ? "Saved key will be removed when you save"
                          : summary.hasSecretKey
                            ? `Saved ••••${summary.secretKeyLast4 ?? ""} — paste a new key to replace it`
                            : "sk_test_… / rk_test_… or sk_live_… / rk_live_…"
                      }
                      autoComplete="new-password"
                      spellCheck={false}
                      className="pr-10 font-mono text-xs"
                      data-testid="stripe-secret-key"
                    />
                    <button
                      type="button"
                      aria-label={showSecretKey ? "Hide Stripe server key" : "Show Stripe server key"}
                      onClick={() => setShowSecretKey((prev) => !prev)}
                      className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                    >
                      {showSecretKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Easiest: paste the secret key. A restricted key only needs Checkout Sessions write access for
                    this integration.
                  </p>
                  {secretKey && !enteredSecretValid && (
                    <p className="text-xs font-medium text-destructive">This should start with sk_ or rk_.</p>
                  )}
                  {summary.secretSource === "environment" && (
                    <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
                      A server environment key is currently being used; saving a key here overrides it.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="stripe-webhook-secret">Webhook signing secret *</Label>
                    {summary.hasWebhookSecret && summary.webhookSource === "database" && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => {
                          setClearWebhookSecret((prev) => !prev);
                          setWebhookSecret("");
                        }}
                      >
                        {clearWebhookSecret ? "Undo removal" : "Remove saved secret"}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="stripe-webhook-secret"
                      type={showWebhookSecret ? "text" : "password"}
                      value={webhookSecret}
                      onChange={(e) => {
                        setWebhookSecret(e.target.value);
                        if (e.target.value) setClearWebhookSecret(false);
                      }}
                      placeholder={
                        clearWebhookSecret
                          ? "Saved secret will be removed when you save"
                          : summary.hasWebhookSecret
                            ? `Saved ••••${summary.webhookSecretLast4 ?? ""} — paste a new secret to replace it`
                            : "whsec_…"
                      }
                      autoComplete="new-password"
                      spellCheck={false}
                      className="pr-10 font-mono text-xs"
                      data-testid="stripe-webhook-secret"
                    />
                    <button
                      type="button"
                      aria-label={showWebhookSecret ? "Hide webhook signing secret" : "Show webhook signing secret"}
                      onClick={() => setShowWebhookSecret((prev) => !prev)}
                      className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                    >
                      {showWebhookSecret ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                    </button>
                  </div>
                  {webhookSecret && !enteredWebhookValid && (
                    <p className="text-xs font-medium text-destructive">This should start with whsec_.</p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="submit" isDisabled={isPending} data-testid="stripe-save-settings">
                  {isPending ? "Saving…" : "Save Stripe settings"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  isDisabled={testing || isPending}
                  onPress={() => void handleTestConnection()}
                  data-testid="stripe-test-connection"
                >
                  <PlugZapIcon className="size-4" aria-hidden />
                  {testing ? "Testing…" : "Test connection"}
                </Button>
              </div>
              {!enabled && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Save the keys first, test the connection, then use the switch above to enable Stripe at checkout.
                </p>
              )}
            </form>
          </div>

          <div className="rounded-xl border bg-background/70 p-4">
            <h3 className="text-xs font-bold tracking-wider uppercase">2-minute Stripe Dashboard setup</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                Open {" "}
                <a
                  href="https://dashboard.stripe.com/apikeys"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline"
                >
                  Stripe → API keys <ExternalLinkIcon className="inline size-3.5" aria-hidden />
                </a>{" "}
                and copy the publishable + secret/restricted keys. Start in <strong className="text-foreground">Test mode</strong>.
              </li>
              <li>
                Open {" "}
                <a
                  href="https://dashboard.stripe.com/webhooks"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline"
                >
                  Stripe → Webhooks <ExternalLinkIcon className="inline size-3.5" aria-hidden />
                </a>{" "}
                → <strong className="text-foreground">Add destination / endpoint</strong>, then paste this URL:
              </li>
            </ol>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={webhookUrl}
                aria-label="Stripe webhook URL"
                className="font-mono text-xs"
                data-testid="stripe-webhook-url"
              />
              <Button type="button" variant="outline" onPress={() => void handleCopyWebhook()}>
                {copiedWebhook ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                {copiedWebhook ? "Copied" : "Copy URL"}
              </Button>
            </div>

            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground" start={3}>
              <li>
                Choose <strong className="text-foreground">Thin events</strong> (recommended for new integrations) and
                select only these events:
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {STRIPE_THIN_EVENT_TYPES.map((event) => (
                    <code key={event} className="rounded-md bg-muted px-2 py-1 text-[11px] break-all text-foreground">
                      {event}
                    </code>
                  ))}
                </span>
                <span className="mt-2 block text-xs">
                  Snapshot destinations also work with the same names without the <code>v1.</code> prefix: {" "}
                  {STRIPE_SNAPSHOT_EVENT_TYPES.join(", ")}.
                </span>
              </li>
              <li>Create the endpoint, reveal its <strong className="text-foreground">Signing secret</strong> (<code>whsec_…</code>), paste it above and save.</li>
              <li>
                Click <strong className="text-foreground">Test connection</strong>, then place a test order using card
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-foreground">4242 4242 4242 4242</code>
                with any future expiry and CVC. The order becomes Paid + Processing only after Stripe confirms it.
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
