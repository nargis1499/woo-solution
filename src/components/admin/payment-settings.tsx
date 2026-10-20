"use client";

import { useState } from "react";
import {
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { savePaymentSettings } from "@/app/nemesis/actions";
import type { CryptoProtocol } from "@/lib/crypto-protocols";
import type { SiteSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function PaymentSettings({ settings }: { settings: SiteSettings }) {
  const [codEnabled, setCodEnabled] = useState<boolean>(
    settings.payment_cod_enabled,
  );
  const [cryptoEnabled, setCryptoEnabled] = useState<boolean>(
    settings.payment_crypto_enabled,
  );
  const [protocols, setProtocols] = useState<CryptoProtocol[]>(
    settings.payment_crypto_protocols,
  );

  // All payment gateway sections are collapsed by default
  const [codExpanded, setCodExpanded] = useState<boolean>(false);
  const [cryptoExpanded, setCryptoExpanded] = useState<boolean>(false);

  // Add / Edit Crypto Protocol modal state
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingProtocol, setEditingProtocol] = useState<CryptoProtocol | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  async function persistPayment(next: {
    payment_crypto_enabled?: boolean;
    payment_cod_enabled?: boolean;
    payment_crypto_protocols?: CryptoProtocol[];
  }) {
    setSaving(true);
    try {
      const res = await savePaymentSettings(next);
      if (!res.ok) {
        if (res.error) toast.error(res.error);
        return false;
      }
      toast.success(res.message ?? "Payment settings saved.");
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCodGateway(enabled: boolean) {
    setCodEnabled(enabled);
    await persistPayment({ payment_cod_enabled: enabled });
  }

  async function handleToggleCryptoGateway(enabled: boolean) {
    setCryptoEnabled(enabled);
    await persistPayment({ payment_crypto_enabled: enabled });
  }

  async function handleToggleProtocol(id: string, enabled: boolean) {
    const next = protocols.map((p) => (p.id === id ? { ...p, enabled } : p));
    setProtocols(next);
    await persistPayment({ payment_crypto_protocols: next });
  }

  async function handleDeleteProtocol(id: string) {
    const target = protocols.find((p) => p.id === id);
    const next = protocols.filter((p) => p.id !== id);
    setProtocols(next);
    const ok = await persistPayment({ payment_crypto_protocols: next });
    if (ok && target) {
      toast.success(`${target.code} (${target.network}) removed.`);
    }
  }

  async function handleUpdateAddressInline(id: string, address: string) {
    const next = protocols.map((p) =>
      p.id === id ? { ...p, address: address.trim() } : p,
    );
    setProtocols(next);
    await persistPayment({ payment_crypto_protocols: next });
  }

  return (
    <div className="space-y-4" data-testid="woocommerce-payment-settings">
      {/* ── 1. Cash on Delivery (COD) Option (Top Section, Collapsed by Default) ── */}
      <div
        className="overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xs"
        data-testid="payment-cod-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <button
            type="button"
            onClick={() => setCodExpanded((v) => !v)}
            aria-expanded={codExpanded}
            data-testid="payment-cod-collapse-toggle"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-left"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <BanknoteIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-base font-extrabold tracking-tight text-foreground">
                  Cash on Delivery (COD)
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                    codEnabled
                      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {codEnabled ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Allow customers to place orders and pay with cash upon delivery
              </p>
            </div>
            <ChevronDownIcon
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
                codExpanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          <div className="flex items-center gap-3 border-l border-border/60 pl-4">
            <span className="text-xs font-medium text-muted-foreground">
              Gateway Status:
            </span>
            <Switch
              aria-label="Enable Cash on Delivery"
              isSelected={codEnabled}
              isDisabled={saving}
              onChange={(val) => void handleToggleCodGateway(val)}
              data-testid="payment-cod-gateway-switch"
            />
          </div>
        </div>

        {codExpanded && (
          <div className="border-t border-border/80 bg-muted/15 px-6 py-4 text-xs text-muted-foreground sm:text-sm">
            When enabled, customers can choose{" "}
            <strong className="font-semibold text-foreground">Cash on Delivery</strong> at
            checkout and complete payment upon receiving their order.
          </div>
        )}
      </div>

      {/* ── 2. Cryptocurrency Payment System (Below COD, Collapsed by Default) ── */}
      <div
        className="overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xs"
        data-testid="payment-crypto-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <button
            type="button"
            onClick={() => setCryptoExpanded((v) => !v)}
            aria-expanded={cryptoExpanded}
            data-testid="payment-crypto-collapse-toggle"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-left"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <CoinsIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-base font-extrabold tracking-tight text-foreground">
                  Enable Crypto Checkout Gateway
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                    cryptoEnabled
                      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {cryptoEnabled ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Allow customers to pay instantly with various crypto wallets (BTC, ETH, USDT, SOL, etc.)
              </p>
            </div>
            <ChevronDownIcon
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
                cryptoExpanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          <div className="flex items-center gap-3 border-l border-border/60 pl-4">
            <span className="text-xs font-medium text-muted-foreground">
              Gateway Status:
            </span>
            <Switch
              aria-label="Enable Crypto Checkout Gateway"
              isSelected={cryptoEnabled}
              isDisabled={saving}
              onChange={(val) => void handleToggleCryptoGateway(val)}
              data-testid="payment-crypto-gateway-switch"
            />
          </div>
        </div>

        {cryptoExpanded && (
          <div className="border-t border-border/80 bg-muted/15 p-6">
            <div className="space-y-5 rounded-2xl border border-border/80 bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-base font-extrabold tracking-tight text-foreground">
                    Supported Crypto Protocols
                  </h3>
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    Configure deposit wallet addresses, networks, and badges shown on checkout.
                  </p>
                </div>

                <Button
                  type="button"
                  onPress={() => {
                    setEditingProtocol(null);
                    setModalOpen(true);
                  }}
                  data-testid="add-crypto-protocol-button"
                  className="rounded-xl px-4 py-2.5 font-bold"
                >
                  <PlusIcon className="size-4" />
                  Add Crypto Protocol
                </Button>
              </div>

              <div className="space-y-3" data-testid="crypto-protocols-list">
                {protocols.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/80 bg-muted/15 px-5 py-8 text-center text-xs text-muted-foreground sm:text-sm">
                    No crypto protocols configured yet. Click{" "}
                    <strong className="font-semibold text-foreground">
                      + Add Crypto Protocol
                    </strong>{" "}
                    to add one.
                  </div>
                ) : (
                  protocols.map((protocol) => (
                    <div
                      key={protocol.id}
                      data-testid={`crypto-protocol-row-${protocol.id}`}
                      className={cn(
                        "flex flex-col gap-4 rounded-2xl border border-border/80 bg-muted/15 p-4 transition-opacity lg:flex-row lg:items-center lg:justify-between",
                        !protocol.enabled && "opacity-60",
                      )}
                    >
                      {/* Left: Coin Code Badge + Name + Network */}
                      <div className="flex min-w-56 items-center gap-3.5">
                        <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border/80 bg-card text-xs font-black tracking-tight text-foreground shadow-2xs">
                          {protocol.code}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-extrabold text-foreground">
                              {protocol.code}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({protocol.name})
                            </span>
                            {protocol.badge && (
                              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-bold text-primary">
                                {protocol.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {protocol.network}
                          </p>
                        </div>
                      </div>

                      {/* Middle: Deposit Address */}
                      <div className="flex-1 space-y-1">
                        <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
                          DEPOSIT ADDRESS
                        </p>
                        <input
                          type="text"
                          defaultValue={protocol.address}
                          onBlur={(e) => {
                            const nextVal = e.target.value.trim();
                            if (nextVal && nextVal !== protocol.address) {
                              void handleUpdateAddressInline(protocol.id, nextVal);
                            }
                          }}
                          aria-label={`${protocol.code} (${protocol.network}) deposit address`}
                          className="h-10 w-full rounded-xl border border-border/80 bg-card px-3.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                      </div>

                      {/* Right: Enable Switch + Edit + Delete */}
                      <div className="flex items-center justify-end gap-3 lg:pl-2">
                        <Switch
                          aria-label={`Enable ${protocol.code} (${protocol.network})`}
                          isSelected={protocol.enabled}
                          isDisabled={saving}
                          onChange={(val) =>
                            void handleToggleProtocol(protocol.id, val)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProtocol(protocol);
                            setModalOpen(true);
                          }}
                          aria-label={`Edit ${protocol.code} (${protocol.network})`}
                          data-testid={`edit-crypto-protocol-${protocol.id}`}
                          className="grid size-9 cursor-pointer place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <SquarePenIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProtocol(protocol.id)}
                          aria-label={`Delete ${protocol.code} (${protocol.network})`}
                          data-testid={`delete-crypto-protocol-${protocol.id}`}
                          className="grid size-9 cursor-pointer place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2Icon className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Add / Edit Crypto Protocol Modal (image3.jpg) ─────────────── */}
      {modalOpen && (
        <CryptoProtocolModal
          initial={editingProtocol}
          saving={saving}
          onClose={() => {
            if (!saving) {
              setModalOpen(false);
              setEditingProtocol(null);
            }
          }}
          onSave={async (entry) => {
            const exists = protocols.some((p) => p.id === entry.id);
            const next = exists
              ? protocols.map((p) => (p.id === entry.id ? entry : p))
              : [...protocols, entry];
            setProtocols(next);
            const ok = await persistPayment({ payment_crypto_protocols: next });
            if (ok) {
              setModalOpen(false);
              setEditingProtocol(null);
            }
          }}
        />
      )}
    </div>
  );
}

function CryptoProtocolModal({
  initial,
  saving,
  onClose,
  onSave,
}: {
  initial: CryptoProtocol | null;
  saving: boolean;
  onClose: () => void;
  onSave: (entry: CryptoProtocol) => Promise<void>;
}) {
  const [code, setCode] = useState<string>(initial?.code ?? "");
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [network, setNetwork] = useState<string>(initial?.network ?? "");
  const [badge, setBadge] = useState<string>(initial?.badge ?? "");
  const [address, setAddress] = useState<string>(initial?.address ?? "");
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanNetwork = network.trim();
    const cleanAddress = address.trim();
    const cleanBadge = badge.trim() || null;

    if (!cleanCode || !cleanName || !cleanNetwork || !cleanAddress) {
      setError("Please fill in Coin Code, Coin Name, Network, and Deposit Address.");
      return;
    }

    setError(null);
    await onSave({
      id: initial?.id ?? `${cleanCode.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      code: cleanCode,
      name: cleanName,
      network: cleanNetwork,
      address: cleanAddress,
      badge: cleanBadge,
      enabled,
    });
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      isDismissable={!saving}
      showCloseButton={false}
      className="sm:max-w-lg"
    >
      <div className="space-y-5" data-testid="crypto-protocol-modal">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/80 pb-4">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <CoinsIcon className="size-5" aria-hidden />
            </span>
            <div>
              <DialogTitle className="text-base font-extrabold tracking-tight text-foreground sm:text-lg">
                {initial ? "Edit Crypto Protocol" : "Add Crypto Protocol"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Configure address and details for checkout
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {error && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive">
            {error}
          </p>
        )}

        {/* Row 1: Coin Code & Coin Name */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="crypto-coin-code"
              className="block text-xs font-semibold text-muted-foreground"
            >
              Coin Code (e.g. USDT)
            </label>
            <Input
              id="crypto-coin-code"
              value={code}
              maxLength={16}
              placeholder="USDT"
              data-testid="crypto-modal-code"
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="crypto-coin-name"
              className="block text-xs font-semibold text-muted-foreground"
            >
              Coin Name (e.g. Tether)
            </label>
            <Input
              id="crypto-coin-name"
              value={name}
              maxLength={60}
              placeholder="Tether USDT"
              data-testid="crypto-modal-name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        {/* Row 2: Network & Badge / Tag */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="crypto-network"
              className="block text-xs font-semibold text-muted-foreground"
            >
              Network (e.g. TRON TRC20)
            </label>
            <Input
              id="crypto-network"
              value={network}
              maxLength={60}
              placeholder="TRON TRC20"
              data-testid="crypto-modal-network"
              onChange={(e) => setNetwork(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="crypto-badge"
              className="block text-xs font-semibold text-muted-foreground"
            >
              Badge / Tag (Optional)
            </label>
            <Input
              id="crypto-badge"
              value={badge}
              maxLength={60}
              placeholder="Recommended • $1 Fee"
              data-testid="crypto-modal-badge"
              onChange={(e) => setBadge(e.target.value)}
            />
          </div>
        </div>

        {/* Row 3: Official Wallet Deposit Address */}
        <div className="space-y-1.5">
          <label
            htmlFor="crypto-address"
            className="block text-xs font-semibold text-muted-foreground"
          >
            Official Wallet Deposit Address
          </label>
          <Input
            id="crypto-address"
            value={address}
            maxLength={160}
            placeholder="0x... or T..."
            data-testid="crypto-modal-address"
            className="font-mono text-xs"
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        {/* Row 4: Enabled for Customer Checkout */}
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          data-testid="crypto-modal-enabled"
          className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground"
        >
          <span
            className={cn(
              "grid size-5 place-items-center rounded-md border transition-colors",
              enabled
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent",
            )}
          >
            {enabled && <CheckIcon className="size-3.5 stroke-[3]" />}
          </span>
          <span>Enabled for Customer Checkout</span>
        </button>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border/80 pt-4">
          <Button
            type="button"
            variant="ghost"
            isDisabled={saving}
            onPress={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            isPending={saving}
            onPress={() => void handleSubmit()}
            data-testid="crypto-modal-save"
            className="rounded-xl px-5 font-bold"
          >
            {saving ? "Saving…" : "Save Method"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
