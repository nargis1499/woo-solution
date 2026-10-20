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
  RefreshCwIcon,
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
import { inferPlisioNetworkInfo, type PlisioCurrency } from "@/lib/plisio";
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
  const [plisioCurrencies, setPlisioCurrencies] = useState<PlisioCurrency[]>(
    settings.payment_plisio_currencies,
  );
  const [showPlisioKey, setShowPlisioKey] = useState<boolean>(false);
  const [copiedWebhook, setCopiedWebhook] = useState<boolean>(false);
  const [syncingPlisio, setSyncingPlisio] = useState<boolean>(false);

  // Quick Add New Plisio Coin form state
  const [newPlisioCid, setNewPlisioCid] = useState("");
  const [newPlisioCode, setNewPlisioCode] = useState("");
  const [newPlisioName, setNewPlisioName] = useState("");
  const [newPlisioNetwork, setNewPlisioNetwork] = useState("");
  const [newPlisioRate, setNewPlisioRate] = useState("1");

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

  // Quick Add New Manual Protocol form state
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
    payment_plisio_currencies?: PlisioCurrency[];
    payment_crypto_enabled?: boolean;
    payment_crypto_protocols?: CryptoProtocol[];
  }) {
    startTransition(async () => {
      try {
        const res = await savePaymentSettings(next);
        if (!res.ok) {
          toast.error(res.error || "Failed to save payment settings");
          return;
        }
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

  async function handleSyncPlisioCoins(secretOverride?: string) {
    const keyToUse = (secretOverride ?? plisioSecretKey).trim();
    if (!keyToUse) {
      toast.error("Please enter your Plisio Secret Key first.");
      return;
    }

    setSyncingPlisio(true);
    try {
      const res = await fetch("/api/plisio/currencies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey: keyToUse }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        currencies?: PlisioCurrency[];
        error?: string;
      } | null;

      if (!data?.ok || !Array.isArray(data.currencies)) {
        toast.error(
          data?.error || "Could not sync currencies from Plisio API.",
        );
        return;
      }

      setPlisioCurrencies(data.currencies);
      toast.success(
        `Synced ${data.currencies.length} cryptocurrencies from your Plisio account!`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to reach Plisio currency sync endpoint.");
    } finally {
      setSyncingPlisio(false);
    }
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
    // If no coins have been loaded yet, automatically sync from Plisio API using the new key
    if (plisioCurrencies.length === 0) {
      await handleSyncPlisioCoins(cleanedKey);
    }
  }

  async function handleTogglePlisioCoin(cid: string, enabled: boolean) {
    const updated = plisioCurrencies.map((c) =>
      c.cid === cid ? { ...c, enabled } : c,
    );
    setPlisioCurrencies(updated);
    await persistPayment({ payment_plisio_currencies: updated });
  }

  async function handleSetAllPlisioCoins(enabled: boolean) {
    const updated = plisioCurrencies.map((c) => ({ ...c, enabled }));
    setPlisioCurrencies(updated);
    await persistPayment({ payment_plisio_currencies: updated });
  }

  function handleChangePlisioCoinField(
    cid: string,
    field: keyof PlisioCurrency,
    value: string | number,
  ) {
    setPlisioCurrencies((prev) =>
      prev.map((c) => (c.cid === cid ? { ...c, [field]: value } : c)),
    );
  }

  async function handleSavePlisioCoinRow() {
    await persistPayment({ payment_plisio_currencies: plisioCurrencies });
  }

  async function handleDeletePlisioCoin(cid: string) {
    const updated = plisioCurrencies.filter((c) => c.cid !== cid);
    setPlisioCurrencies(updated);
    await persistPayment({ payment_plisio_currencies: updated });
  }

  async function handleAddPlisioCoin(e: React.FormEvent) {
    e.preventDefault();
    const cid = newPlisioCid.trim().toUpperCase();
    if (!cid) {
      toast.error(
        "Please enter the Plisio CID (e.g. USDT_TRX, USDT_BSC, BTC, ETH, SOL, TON).",
      );
      return;
    }
    if (plisioCurrencies.some((c) => c.cid.toUpperCase() === cid)) {
      toast.error(`Coin ${cid} already exists in your Plisio list.`);
      return;
    }

    const inferred = inferPlisioNetworkInfo(
      cid,
      newPlisioName.trim() || undefined,
      newPlisioCode.trim() || undefined,
    );
    const parsedRate = Number(newPlisioRate);
    const newCoin: PlisioCurrency = {
      cid,
      code: newPlisioCode.trim().toUpperCase() || inferred.code,
      name: newPlisioName.trim() || inferred.name,
      network: newPlisioNetwork.trim() || inferred.network,
      networkTag: inferred.networkTag,
      badge: null,
      eta: inferred.eta,
      approxUsdRate:
        Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 1,
      decimals: inferred.decimals,
      enabled: true,
    };

    const updated = [...plisioCurrencies, newCoin];
    setPlisioCurrencies(updated);
    setNewPlisioCid("");
    setNewPlisioCode("");
    setNewPlisioName("");
    setNewPlisioNetwork("");
    setNewPlisioRate("1");
    await persistPayment({ payment_plisio_currencies: updated });
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
  const activePlisioCoinCount = plisioCurrencies.filter((c) => c.enabled).length;

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
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {activePlisioCoinCount} / {plisioCurrencies.length} coins active
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

              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="plisio-secret-key">
                    Secret Key (from Plisio Dashboard → Shops → API Settings)
                  </Label>
                  <div className="relative">
                    <Input
                      id="plisio-secret-key"
                      type={showPlisioKey ? "text" : "password"}
                      placeholder="Enter your Plisio Secret Key"
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
                  isDisabled={isPending || syncingPlisio}
                  data-testid="payment-plisio-save-key"
                >
                  Save Secret Key
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={isPending || syncingPlisio || !hasPlisioKey}
                  onPress={() => void handleSyncPlisioCoins()}
                  data-testid="payment-plisio-sync-coins"
                >
                  <RefreshCwIcon
                    className={cn("size-3.5", syncingPlisio && "animate-spin")}
                  />
                  {syncingPlisio ? "Syncing from Plisio…" : "Sync Coins from Plisio API"}
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
                    onPress={() => void handleCopyWebhook()}
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

            {/* Dynamic Plisio Coins Management Section */}
            <div className="space-y-3" data-testid="plisio-currencies-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                    Plisio Cryptocurrencies ({activePlisioCoinCount} Enabled /{" "}
                    {plisioCurrencies.length} Total)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Toggle which Plisio coins are shown in Quick Checkout &amp; /checkout, or edit their display labels and rates.
                  </p>
                </div>

                {plisioCurrencies.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      isDisabled={isPending}
                      onPress={() => void handleSetAllPlisioCoins(true)}
                      data-testid="payment-plisio-enable-all"
                    >
                      Enable All
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      isDisabled={isPending}
                      onPress={() => void handleSetAllPlisioCoins(false)}
                      data-testid="payment-plisio-disable-all"
                    >
                      Disable All
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2.5" data-testid="plisio-currencies-list">
                {plisioCurrencies.map((coin) => (
                  <div
                    key={coin.cid}
                    data-testid={`plisio-coin-row-${coin.cid.toLowerCase()}`}
                    className={cn(
                      "rounded-xl border p-4 transition-colors",
                      coin.enabled
                        ? "border-border bg-background"
                        : "border-border/60 bg-muted/25 opacity-75",
                    )}
                  >
                    <div className="grid gap-3 md:grid-cols-[130px_100px_160px_1fr_130px_auto] md:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor={`plisio-cid-${coin.cid}`}>Plisio CID</Label>
                        <Input
                          id={`plisio-cid-${coin.cid}`}
                          value={coin.cid}
                          readOnly
                          className="bg-muted/40 font-mono text-xs font-bold uppercase"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`plisio-code-${coin.cid}`}>Symbol</Label>
                        <Input
                          id={`plisio-code-${coin.cid}`}
                          value={coin.code}
                          onChange={(e) =>
                            handleChangePlisioCoinField(
                              coin.cid,
                              "code",
                              e.target.value.toUpperCase(),
                            )
                          }
                          onBlur={() => void handleSavePlisioCoinRow()}
                          className="font-mono font-bold uppercase"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`plisio-name-${coin.cid}`}>
                          Currency Name
                        </Label>
                        <Input
                          id={`plisio-name-${coin.cid}`}
                          value={coin.name}
                          onChange={(e) =>
                            handleChangePlisioCoinField(
                              coin.cid,
                              "name",
                              e.target.value,
                            )
                          }
                          onBlur={() => void handleSavePlisioCoinRow()}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`plisio-network-${coin.cid}`}>
                          Protocol / Network
                        </Label>
                        <Input
                          id={`plisio-network-${coin.cid}`}
                          value={coin.network}
                          onChange={(e) =>
                            handleChangePlisioCoinField(
                              coin.cid,
                              "network",
                              e.target.value,
                            )
                          }
                          onBlur={() => void handleSavePlisioCoinRow()}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`plisio-rate-${coin.cid}`}>
                          USD Rate ($)
                        </Label>
                        <Input
                          id={`plisio-rate-${coin.cid}`}
                          type="number"
                          step="any"
                          value={String(coin.approxUsdRate)}
                          onChange={(e) =>
                            handleChangePlisioCoinField(
                              coin.cid,
                              "approxUsdRate",
                              Number(e.target.value) || 1,
                            )
                          }
                          onBlur={() => void handleSavePlisioCoinRow()}
                          className="font-mono text-xs"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2.5 pb-1">
                        <Switch
                          aria-label={`Enable ${coin.cid}`}
                          isSelected={coin.enabled}
                          isDisabled={isPending}
                          onChange={(enabled) =>
                            void handleTogglePlisioCoin(coin.cid, enabled)
                          }
                          data-testid={`plisio-coin-switch-${coin.cid.toLowerCase()}`}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${coin.cid}`}
                          isDisabled={isPending}
                          onPress={() => void handleDeletePlisioCoin(coin.cid)}
                          data-testid={`plisio-coin-delete-${coin.cid.toLowerCase()}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {plisioCurrencies.length === 0 && (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No Plisio cryptocurrencies configured yet. Enter your{" "}
                    <strong className="font-semibold text-foreground">
                      Plisio Secret Key
                    </strong>{" "}
                    above and click{" "}
                    <strong className="font-semibold text-foreground">
                      Sync Coins from Plisio API
                    </strong>{" "}
                    to load all coins from your Plisio Shop, or add a coin manually below.
                  </div>
                )}
              </div>

              {/* Add Custom Plisio Coin Form */}
              <form
                onSubmit={(e) => void handleAddPlisioCoin(e)}
                className="rounded-xl border border-dashed bg-muted/20 p-4"
                data-testid="add-plisio-coin-form"
              >
                <p className="mb-3 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  Add Plisio Coin Manually
                </p>
                <div className="grid gap-3 md:grid-cols-[130px_100px_160px_1fr_130px_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plisio-cid">Plisio CID *</Label>
                    <Input
                      id="new-plisio-cid"
                      placeholder="USDT_TRX"
                      value={newPlisioCid}
                      onChange={(e) =>
                        setNewPlisioCid(e.target.value.toUpperCase())
                      }
                      className="font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plisio-code">Symbol</Label>
                    <Input
                      id="new-plisio-code"
                      placeholder="USDT"
                      value={newPlisioCode}
                      onChange={(e) =>
                        setNewPlisioCode(e.target.value.toUpperCase())
                      }
                      className="font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plisio-name">Name</Label>
                    <Input
                      id="new-plisio-name"
                      placeholder="Tether USD"
                      value={newPlisioName}
                      onChange={(e) => setNewPlisioName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plisio-network">Protocol / Network</Label>
                    <Input
                      id="new-plisio-network"
                      placeholder="TRON (TRC20)"
                      value={newPlisioNetwork}
                      onChange={(e) => setNewPlisioNetwork(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plisio-rate">USD Rate ($)</Label>
                    <Input
                      id="new-plisio-rate"
                      type="number"
                      step="any"
                      placeholder="1"
                      value={newPlisioRate}
                      onChange={(e) => setNewPlisioRate(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    isDisabled={isPending}
                    data-testid="add-plisio-coin-submit"
                  >
                    <PlusIcon className="size-4" />
                    Add Coin
                  </Button>
                </div>
              </form>
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
