"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { savePaymentSettings } from "@/app/nemesis/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CryptoProtocol } from "@/lib/crypto-protocols";
import { PLISIO_CURRENCIES } from "@/lib/plisio";
import type { SiteSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PaymentSettings({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [codEnabled, setCodEnabled] = useState<boolean>(
    settings.payment_cod_enabled,
  );
  const [plisioEnabled, setPlisioEnabled] = useState<boolean>(
    settings.payment_plisio_enabled,
  );
  const [plisioTestMode, setPlisioTestMode] = useState<boolean>(
    settings.payment_plisio_test_mode,
  );
  const [plisioSecretKey, setPlisioSecretKey] = useState<string>(
    settings.payment_plisio_secret_key ?? "",
  );
  const [showPlisioKey, setShowPlisioKey] = useState<boolean>(false);
  const [copiedWebhook, setCopiedWebhook] = useState<boolean>(false);

  const [cryptoEnabled, setCryptoEnabled] = useState<boolean>(
    settings.payment_crypto_enabled,
  );
  const [protocols, setProtocols] = useState<CryptoProtocol[]>(
    settings.payment_crypto_protocols,
  );

  // Payment gateway sections are collapsed by default
  const [codExpanded, setCodExpanded] = useState<boolean>(false);
  const [plisioExpanded, setPlisioExpanded] = useState<boolean>(false);
  const [cryptoExpanded, setCryptoExpanded] = useState<boolean>(false);

  // Quick Add New Protocol form state
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newNetwork, setNewNetwork] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [isPending, startTransition] = useTransition();

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/plisio/callback?json=true`
      : "https://woo-solution.woo-solution.workers.dev/api/plisio/callback?json=true";

  async function persistPayment(next: {
    payment_cod_enabled?: boolean;
    payment_plisio_enabled?: boolean;
    payment_plisio_test_mode?: boolean;
    payment_plisio_secret_key?: string | null;
    payment_crypto_enabled?: boolean;
    payment_crypto_protocols?: CryptoProtocol[];
  }) {
    startTransition(async () => {
      try {
        const res = await savePaymentSettings(next);
        toast.success(res.message || "Payment settings saved");
        router.refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to save payment settings",
        );
      }
    });
  }

  async function handleToggleCod(enabled: boolean) {
    setCodEnabled(enabled);
    await persistPayment({ payment_cod_enabled: enabled });
  }

  async function handleTogglePlisio(enabled: boolean) {
    setPlisioEnabled(enabled);
    if (enabled) {
      setPlisioExpanded(true);
    }
    await persistPayment({
      payment_plisio_enabled: enabled,
      payment_plisio_test_mode: plisioTestMode,
      payment_plisio_secret_key: plisioSecretKey.trim() || null,
    });
  }

  async function handleTogglePlisioTestMode(enabled: boolean) {
    setPlisioTestMode(enabled);
    await persistPayment({
      payment_plisio_test_mode: enabled,
    });
  }

  async function handleSavePlisioKey(e: React.FormEvent) {
    e.preventDefault();
    const cleanedKey = plisioSecretKey.trim();
    if (!cleanedKey) {
      toast.error("Please enter your Plisio Secret Key.");
      return;
    }
    await persistPayment({
      payment_plisio_enabled: plisioEnabled,
      payment_plisio_secret_key: cleanedKey,
    });
  }

  async function handleCopyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      toast.success("Plisio Webhook URL copied to clipboard!");
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      toast.error("Could not copy automatically — please copy the URL manually.");
    }
  }

  async function handleToggleCrypto(enabled: boolean) {
    setCryptoEnabled(enabled);
    await persistPayment({ payment_crypto_enabled: enabled });
  }

  async function handleToggleProtocol(id: string, enabled: boolean) {
    const updated = protocols.map((p) => (p.id === id ? { ...p, enabled } : p));
    setProtocols(updated);
    await persistPayment({ payment_crypto_protocols: updated });
  }

  function handleChangeProtocolField(
    id: string,
    field: keyof CryptoProtocol,
    value: string,
  ) {
    setProtocols((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  }

  async function handleSaveProtocolRow() {
    await persistPayment({ payment_crypto_protocols: protocols });
  }

  async function handleDeleteProtocol(id: string) {
    const updated = protocols.filter((p) => p.id !== id);
    setProtocols(updated);
    await persistPayment({ payment_crypto_protocols: updated });
  }

  async function handleAddProtocol(e: React.FormEvent) {
    e.preventDefault();
    const code = newCode.trim().toUpperCase();
    const name = newName.trim() || code;
    const network = newNetwork.trim() || `${code} Mainnet`;
    const address = newAddress.trim();

    if (!code || !address) {
      toast.error(
        "Please enter both the Currency Symbol (e.g. USDT, BTC) and Deposit Wallet Address.",
      );
      return;
    }

    const newItem: CryptoProtocol = {
      id: `${code.toLowerCase()}-${Date.now().toString(36)}`,
      code,
      name,
      network,
      address,
      badge: null,
      enabled: true,
    };

    const updated = [...protocols, newItem];
    setProtocols(updated);
    setNewCode("");
    setNewName("");
    setNewNetwork("");
    setNewAddress("");
    await persistPayment({ payment_crypto_protocols: updated });
  }

  const hasPlisioKey = Boolean(plisioSecretKey.trim());

  return (
    <div className="space-y-4">
      {/* 1. Cash on Delivery (COD) Gateway Card — TOP */}
      <div
        className="overflow-hidden rounded-2xl border bg-card"
        data-testid="payment-cod-card"
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={codExpanded}
          data-testid="payment-cod-header"
          onClick={() => setCodExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCodExpanded((prev) => !prev);
            }
          }}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors select-none hover:bg-muted/30"
        >
          <div className="flex items-center gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-500">
              <BanknoteIcon className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-base font-semibold tracking-tight">
                  Cash on Delivery (COD)
                </h2>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                    codEnabled
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {codEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Switch
              aria-label="Enable Cash on Delivery"
              isSelected={codEnabled}
              isDisabled={isPending}
              onChange={(enabled) => void handleToggleCod(enabled)}
              data-testid="payment-cod-switch"
            />
            <button
              type="button"
              aria-label={
                codExpanded
                  ? "Collapse Cash on Delivery"
                  : "Expand Cash on Delivery"
              }
              onClick={() => setCodExpanded((prev) => !prev)}
              className="grid size-8 cursor-pointer place-items-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform duration-200",
                  codExpanded && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>

        {codExpanded && (
          <div
            className="border-t bg-muted/15 px-6 py-4"
            data-testid="payment-cod-body"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  Pay with cash upon delivery
                </p>
                <p className="text-xs text-muted-foreground">
                  Available in both the 4-Step Quick Checkout modal and the
                  standard Checkout page when enabled.
                </p>
              </div>
              <Switch
                aria-label="Toggle Cash on Delivery status"
                isSelected={codEnabled}
                isDisabled={isPending}
                onChange={(enabled) => void handleToggleCod(enabled)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Plisio Automated Cryptocurrency Payment Gateway Card — MIDDLE */}
      <div
        className="overflow-hidden rounded-2xl border bg-card"
        data-testid="payment-plisio-card"
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={plisioExpanded}
          data-testid="payment-plisio-header"
          onClick={() => setPlisioExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setPlisioExpanded((prev) => !prev);
            }
          }}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors select-none hover:bg-muted/30"
        >
          <div className="flex items-center gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-sky-500/25 bg-sky-500/10 text-sky-500">
              <ZapIcon className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-base font-semibold tracking-tight">
                  Plisio Automated Crypto Gateway
                </h2>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                    plisioEnabled
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {plisioEnabled ? "Enabled" : "Disabled"}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    hasPlisioKey
                      ? "border border-sky-500/30 bg-sky-500/10 text-sky-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {hasPlisioKey ? "Secret Key Configured" : "No Secret Key"}
                </span>
                <span
                  data-testid="payment-plisio-mode-badge"
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                    plisioTestMode
                      ? "border border-amber-500/35 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border border-emerald-500/30 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {plisioTestMode ? "Test Mode" : "Live Mode"}
                </span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Switch
              aria-label="Enable Plisio Automated Crypto Gateway"
              isSelected={plisioEnabled}
              isDisabled={isPending}
              onChange={(enabled) => void handleTogglePlisio(enabled)}
              data-testid="payment-plisio-switch"
            />
            <button
              type="button"
              aria-label={
                plisioExpanded
                  ? "Collapse Plisio Crypto Gateway"
                  : "Expand Plisio Crypto Gateway"
              }
              onClick={() => setPlisioExpanded((prev) => !prev)}
              className="grid size-8 cursor-pointer place-items-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform duration-200",
                  plisioExpanded && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>

        {plisioExpanded && (
          <div
            className="space-y-5 border-t bg-muted/10 p-6"
            data-testid="payment-plisio-body"
          >
            {/* Test Mode Toggle Card */}
            <div
              data-testid="payment-plisio-test-mode-row"
              className={cn(
                "flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition-colors",
                plisioTestMode
                  ? "border-amber-500/40 bg-amber-500/[0.08]"
                  : "border-border bg-background/70",
              )}
            >
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    Test Mode (Admin-Only Sandbox Simulation)
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                      plisioTestMode
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {plisioTestMode
                      ? "Admin Simulation Enabled"
                      : "Disabled · Real Payments Only"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {plisioTestMode
                    ? "Test Mode is ON for Admin accounts only — logged-in Admins can simulate payments at checkout, while regular customers always receive real live Plisio invoices."
                    : "Test Mode is OFF — strictly enforces real Plisio API & blockchain verification for all users."}
                </p>
              </div>

              <Switch
                aria-label="Enable Plisio Test Mode"
                isSelected={plisioTestMode}
                isDisabled={isPending}
                onChange={(enabled) => void handleTogglePlisioTestMode(enabled)}
                data-testid="payment-plisio-test-mode-switch"
              />
            </div>

            {/* Secret Key Configuration Form */}
            <form
              onSubmit={(e) => void handleSavePlisioKey(e)}
              className="rounded-xl border bg-background/70 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRoundIcon className="size-4 text-sky-500" aria-hidden />
                  <h3 className="text-xs font-bold tracking-wider text-foreground uppercase">
                    Plisio API Secret Key Configuration
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <ShieldCheckIcon className="size-3.5" aria-hidden />
                  Auto-updates Order to Paid &amp; Processing
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="plisio-secret-key">
                    Secret Key (from Plisio Dashboard → Shops → API Settings)
                  </Label>
                  <div className="relative">
                    <Input
                      id="plisio-secret-key"
                      type={showPlisioKey ? "text" : "password"}
                      placeholder="Enter your Plisio Secret Key (e.g. sk_plisio_...)"
                      value={plisioSecretKey}
                      onChange={(e) => setPlisioSecretKey(e.target.value)}
                      className="pr-10 font-mono text-xs"
                      data-testid="payment-plisio-secret-input"
                    />
                    <button
                      type="button"
                      aria-label={
                        showPlisioKey
                          ? "Hide Plisio Secret Key"
                          : "Show Plisio Secret Key"
                      }
                      onClick={() => setShowPlisioKey((prev) => !prev)}
                      className="absolute inset-y-0 right-2 grid w-8 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                    >
                      {showPlisioKey ? (
                        <EyeOffIcon className="size-4" aria-hidden />
                      ) : (
                        <EyeIcon className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  isDisabled={isPending}
                  data-testid="payment-plisio-save-key"
                >
                  Save Secret Key
                </Button>
              </div>

              {/* Webhook Callback URL */}
              <div className="mt-4 space-y-1.5 border-t border-border/70 pt-3.5">
                <Label htmlFor="plisio-webhook-url">
                  Status / Webhook Callback URL (Auto-sent per invoice &amp; for Plisio Shop settings)
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="plisio-webhook-url"
                    readOnly
                    value={webhookUrl}
                    className="bg-muted/40 font-mono text-xs"
                    data-testid="payment-plisio-webhook-url"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleCopyWebhook()}
                    data-testid="payment-plisio-copy-webhook"
                  >
                    {copiedWebhook ? (
                      <>
                        <CheckIcon className="size-3.5 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <CopyIcon className="size-3.5" />
                        Copy Webhook URL
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>

            {/* Supported Plisio Cryptocurrencies Preview */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  Supported Plisio White-Label Coins ({PLISIO_CURRENCIES.length})
                </p>
                <span className="text-xs text-muted-foreground">
                  Displayed automatically in Quick Checkout &amp; /checkout when enabled
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PLISIO_CURRENCIES.map((coin) => (
                  <div
                    key={coin.cid}
                    className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-extrabold text-foreground">
                        {coin.code}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {coin.network}
                      </p>
                    </div>
                    <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-500">
                      {coin.networkTag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Manual Crypto Payment Gateway Card — BOTTOM */}
      <div
        className="overflow-hidden rounded-2xl border bg-card"
        data-testid="payment-crypto-card"
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={cryptoExpanded}
          data-testid="payment-crypto-header"
          onClick={() => setCryptoExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCryptoExpanded((prev) => !prev);
            }
          }}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors select-none hover:bg-muted/30"
        >
          <div className="flex items-center gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-500">
              <CoinsIcon className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-base font-semibold tracking-tight">
                  Manual Crypto Checkout Gateway
                </h2>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                    cryptoEnabled
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {cryptoEnabled ? "Enabled" : "Disabled"}
                </span>
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {protocols.filter((p) => p.enabled).length} / {protocols.length}{" "}
                  protocols active
                </span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Switch
              aria-label="Enable Crypto Checkout"
              isSelected={cryptoEnabled}
              isDisabled={isPending}
              onChange={(enabled) => void handleToggleCrypto(enabled)}
              data-testid="payment-crypto-switch"
            />
            <button
              type="button"
              aria-label={
                cryptoExpanded
                  ? "Collapse Crypto Checkout Gateway"
                  : "Expand Crypto Checkout Gateway"
              }
              onClick={() => setCryptoExpanded((prev) => !prev)}
              className="grid size-8 cursor-pointer place-items-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform duration-200",
                  cryptoExpanded && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>

        {cryptoExpanded && (
          <div
            className="space-y-5 border-t bg-muted/10 p-6"
            data-testid="payment-crypto-body"
          >
            {/* Existing Protocol Rows */}
            <div className="space-y-3" data-testid="crypto-protocols-list">
              {protocols.map((protocol) => (
                <div
                  key={protocol.id}
                  data-testid={`crypto-protocol-row-${protocol.code.toLowerCase()}`}
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    protocol.enabled
                      ? "border-border bg-background"
                      : "border-border/60 bg-muted/25 opacity-75",
                  )}
                >
                  <div className="grid gap-3 md:grid-cols-[120px_160px_190px_1fr_auto] md:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`code-${protocol.id}`}>Symbol</Label>
                      <Input
                        id={`code-${protocol.id}`}
                        value={protocol.code}
                        onChange={(e) =>
                          handleChangeProtocolField(
                            protocol.id,
                            "code",
                            e.target.value.toUpperCase(),
                          )
                        }
                        onBlur={() => void handleSaveProtocolRow()}
                        className="font-mono font-bold uppercase"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`name-${protocol.id}`}>Currency Name</Label>
                      <Input
                        id={`name-${protocol.id}`}
                        value={protocol.name}
                        onChange={(e) =>
                          handleChangeProtocolField(
                            protocol.id,
                            "name",
                            e.target.value,
                          )
                        }
                        onBlur={() => void handleSaveProtocolRow()}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`network-${protocol.id}`}>
                        Protocol / Network
                      </Label>
                      <Input
                        id={`network-${protocol.id}`}
                        value={protocol.network}
                        onChange={(e) =>
                          handleChangeProtocolField(
                            protocol.id,
                            "network",
                            e.target.value,
                          )
                        }
                        onBlur={() => void handleSaveProtocolRow()}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`address-${protocol.id}`}>
                        Deposit Wallet Address
                      </Label>
                      <Input
                        id={`address-${protocol.id}`}
                        value={protocol.address}
                        onChange={(e) =>
                          handleChangeProtocolField(
                            protocol.id,
                            "address",
                            e.target.value,
                          )
                        }
                        onBlur={() => void handleSaveProtocolRow()}
                        className="font-mono text-xs"
                        data-testid={`crypto-protocol-address-${protocol.code.toLowerCase()}`}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pb-1">
                      <Switch
                        aria-label={`Enable ${protocol.code}`}
                        isSelected={protocol.enabled}
                        isDisabled={isPending}
                        onChange={(enabled) =>
                          void handleToggleProtocol(protocol.id, enabled)
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${protocol.code}`}
                        isDisabled={isPending}
                        onPress={() => void handleDeleteProtocol(protocol.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {protocols.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No manual crypto protocols configured yet. Add one below to
                  accept manual wallet transfers.
                </div>
              )}
            </div>

            {/* Add New Crypto Protocol Form */}
            <form
              onSubmit={(e) => void handleAddProtocol(e)}
              className="rounded-xl border border-dashed bg-muted/20 p-4"
              data-testid="add-crypto-protocol-form"
            >
              <p className="mb-3 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                Add Manual Crypto Protocol
              </p>
              <div className="grid gap-3 md:grid-cols-[110px_150px_180px_1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="new-crypto-code">Symbol *</Label>
                  <Input
                    id="new-crypto-code"
                    placeholder="SOL"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    className="font-mono uppercase"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-crypto-name">Name</Label>
                  <Input
                    id="new-crypto-name"
                    placeholder="Solana"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-crypto-network">Protocol / Network</Label>
                  <Input
                    id="new-crypto-network"
                    placeholder="Solana (SPL)"
                    value={newNetwork}
                    onChange={(e) => setNewNetwork(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-crypto-address">
                    Deposit Wallet Address *
                  </Label>
                  <Input
                    id="new-crypto-address"
                    placeholder="Enter wallet address for customer deposits..."
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  isDisabled={isPending}
                  data-testid="add-crypto-protocol-submit"
                >
                  <PlusIcon className="size-4" />
                  Add Protocol
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
