"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  estimatePlisioCryptoAmount,
  PLISIO_CURRENCIES,
  type PlisioCurrency,
  type PlisioInvoiceSession,
} from "@/lib/plisio";
import { generateQrMatrix } from "@/lib/qr-code";
import { cn } from "@/lib/utils";

function PlisioQrCodeSvg({ value }: { value: string }) {
  const cells = generateQrMatrix(value);
  const size = cells.length;
  const quietZone = 2;
  const totalSize = size + quietZone * 2;

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      className="size-28 shrink-0 text-zinc-950"
      shapeRendering="crispEdges"
      aria-label="Plisio deposit address QR code"
    >
      <rect x={0} y={0} width={totalSize} height={totalSize} fill="#ffffff" />
      {cells.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect
              key={`${r}-${c}`}
              x={c + quietZone}
              y={r + quietZone}
              width={1}
              height={1}
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function PlisioCoinSelector({
  selectedCid,
  active,
  totalMicros,
  formattedStoreTotal,
  onSelectCoin,
  testIdPrefix = "plisio",
}: {
  selectedCid: string;
  active: boolean;
  totalMicros: number;
  formattedStoreTotal: string;
  onSelectCoin: (currency: PlisioCurrency) => void;
  testIdPrefix?: string;
}) {
  const selectedCurrency =
    PLISIO_CURRENCIES.find((c) => c.cid === selectedCid) ?? PLISIO_CURRENCIES[0];
  const estimatedCrypto = estimatePlisioCryptoAmount(totalMicros, selectedCurrency);

  return (
    <div className="space-y-3.5" data-testid={`${testIdPrefix}-section`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
            INSTANT CRYPTO CHECKOUT (PLISIO AUTO-VERIFY)
          </p>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400">
            <ZapIcon className="size-3 fill-current" aria-hidden />
            No Manual TXID Required
          </span>
        </div>
        <p className="text-xs font-extrabold text-primary tabular-nums sm:text-sm">
          Total Due: {formattedStoreTotal}
        </p>
      </div>

      {/* Coin Grid */}
      <div
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        data-testid={`${testIdPrefix}-coin-grid`}
      >
        {PLISIO_CURRENCIES.map((coin) => {
          const isSelected = active && coin.cid === selectedCurrency.cid;
          const coinEstimate = estimatePlisioCryptoAmount(totalMicros, coin);
          return (
            <button
              key={coin.cid}
              type="button"
              onClick={() => onSelectCoin(coin)}
              data-testid={`${testIdPrefix}-coin-${coin.cid}`}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "relative flex cursor-pointer flex-col items-start justify-between rounded-2xl border p-3 text-left transition-all",
                isSelected
                  ? "border-2 border-primary bg-primary/[0.06] shadow-xs ring-2 ring-primary/15"
                  : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
              )}
            >
              <div className="flex w-full items-center justify-between gap-1.5">
                <span className="text-sm font-black tracking-tight text-foreground">
                  {coin.code}
                </span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-tight uppercase",
                    isSelected
                      ? "bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground)"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {coin.networkTag}
                </span>
              </div>

              <p className="mt-1 line-clamp-1 text-[11px] font-medium text-muted-foreground">
                {coin.network}
              </p>

              <div className="mt-2 flex w-full items-center justify-between gap-1 border-t border-border/60 pt-1.5">
                <span className="font-mono text-[11px] font-extrabold text-primary tabular-nums">
                  ≈ {coinEstimate} {coin.code}
                </span>
                <span className="text-[10px] text-muted-foreground">{coin.eta}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Plisio Coin Hassle-Free Summary Banner */}
      {active && (
        <div
          className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] via-card to-emerald-500/[0.05] p-4 shadow-2xs"
          data-testid={`${testIdPrefix}-selected-banner`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground) shadow-xs">
                <ShieldCheckIcon className="size-5" aria-hidden />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-foreground sm:text-base">
                    {selectedCurrency.name} ({selectedCurrency.code})
                  </span>
                  <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">
                    {selectedCurrency.network}
                  </span>
                  {selectedCurrency.badge && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      <SparklesIcon className="size-2.5" aria-hidden />
                      {selectedCurrency.badge}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Automated Plisio blockchain detection · Order moves to{" "}
                  <strong className="font-semibold text-foreground">Paid</strong> &amp;{" "}
                  <strong className="font-semibold text-foreground">Processing</strong>{" "}
                  automatically
                </p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-[11px] font-semibold text-muted-foreground">
                Estimated Crypto Total
              </p>
              <p className="font-mono text-base font-black text-primary tabular-nums sm:text-lg">
                {estimatedCrypto} {selectedCurrency.code}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlisioLiveInvoiceConsole({
  invoice,
  formattedStoreTotal,
  onConfirmed,
  testIdPrefix = "plisio-invoice",
}: {
  invoice: PlisioInvoiceSession;
  formattedStoreTotal: string;
  onConfirmed: (data: {
    txId: string;
    paymentStatus: string;
    orderStatus: string;
  }) => void;
  testIdPrefix?: string;
}) {
  const [copiedField, setCopiedField] = useState<"amount" | "address" | null>(null);
  const [checking, setChecking] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number>(() =>
    Math.max(0, Math.floor((invoice.expiresAtMs - Date.now()) / 1000)),
  );

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSec(Math.max(0, Math.floor((invoice.expiresAtMs - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [invoice.expiresAtMs]);

  const checkStatus = useCallback(
    async (manual = false) => {
      if (manual) setChecking(true);
      try {
        const res = await fetch(
          `/api/plisio/verify?orderId=${encodeURIComponent(invoice.orderId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          paid?: boolean;
          paymentStatus?: string;
          orderStatus?: string;
          txId?: string | null;
        } | null;

        if (data?.paid) {
          toast.success(
            "Payment confirmed on blockchain! Order is now Paid & Processing.",
          );
          onConfirmed({
            txId: data.txId || invoice.txnId,
            paymentStatus: data.paymentStatus || "paid",
            orderStatus: data.orderStatus || "processing",
          });
          return;
        }
        if (manual) {
          toast.info(
            "Listening on blockchain — as soon as your transfer confirms, this screen updates automatically.",
          );
        }
      } catch {
        if (manual) toast.error("Could not reach verification server.");
      } finally {
        if (manual) setChecking(false);
      }
    },
    [invoice.orderId, invoice.txnId, onConfirmed],
  );

  // Automatic background polling every 4 seconds
  useEffect(() => {
    const poll = setInterval(() => {
      void checkStatus(false);
    }, 4000);
    return () => clearInterval(poll);
  }, [checkStatus]);

  async function handleSimulateConfirm() {
    setSimulating(true);
    try {
      const res = await fetch("/api/plisio/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: invoice.orderId,
          simulateConfirm: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        paid?: boolean;
        paymentStatus?: string;
        orderStatus?: string;
        txId?: string | null;
      } | null;

      if (data?.paid) {
        toast.success(
          "Plisio blockchain payment verified! Order status set to Paid & Processing.",
        );
        onConfirmed({
          txId: data.txId || invoice.txnId,
          paymentStatus: data.paymentStatus || "paid",
          orderStatus: data.orderStatus || "processing",
        });
      }
    } finally {
      setSimulating(false);
    }
  }

  async function copyValue(value: string, field: "amount" | "address") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success(
        field === "amount"
          ? `Exact amount (${value} ${invoice.code}) copied!`
          : "Plisio deposit address copied!",
      );
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Please select and copy the value manually.");
    }
  }

  const mins = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const secs = String(remainingSec % 60).padStart(2, "0");

  return (
    <div
      className="space-y-4 rounded-2xl border border-primary/30 bg-card p-5 shadow-sm"
      data-testid={testIdPrefix}
    >
      {/* 1. Top Live Blockchain Listener Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-xs font-extrabold text-foreground sm:text-sm">
              Plisio Live Blockchain Listener Active
            </p>
            <p className="text-[11px] text-muted-foreground">
              Invoice <span className="font-mono font-semibold">{invoice.txnId}</span> ·
              Auto-updates to <strong className="text-foreground">Paid</strong> &amp;{" "}
              <strong className="text-foreground">Processing</strong> on confirmation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 font-mono text-xs font-extrabold text-foreground shadow-2xs tabular-nums">
          <ClockIcon className="size-3.5 text-primary" aria-hidden />
          <span>
            {mins}:{secs}
          </span>
        </div>
      </div>

      {/* 2. QR Code + Hassle-Free 1-Click Copy Amount & Address */}
      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/80 bg-white p-3.5 shadow-xs">
          <PlisioQrCodeSvg value={invoice.walletAddress} />
          <span className="mt-2 text-[9px] font-black tracking-wider text-zinc-900 uppercase">
            SCAN WITH WALLET
          </span>
          <span className="text-[9px] font-semibold text-zinc-500">
            {invoice.code} · {invoice.networkTag}
          </span>
        </div>

        <div className="space-y-3">
          {/* Exact Amount to Send */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
              <span>1. SEND EXACT {invoice.code} AMOUNT</span>
              <span className="text-primary">{formattedStoreTotal}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                data-testid={`${testIdPrefix}-amount`}
                className="flex h-11 flex-1 items-center justify-between rounded-xl border border-border/80 bg-muted/35 px-3.5 font-mono text-sm font-black text-foreground tabular-nums"
              >
                <span>
                  {invoice.cryptoAmount} {invoice.code}
                </span>
                <span className="rounded-md bg-primary/12 px-2 py-0.5 font-sans text-[10px] font-bold text-primary">
                  {invoice.network}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void copyValue(invoice.cryptoAmount, "amount")}
                data-testid={`${testIdPrefix}-copy-amount`}
                className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3.5 text-xs font-extrabold text-foreground shadow-2xs transition-colors hover:bg-muted/60"
              >
                {copiedField === "amount" ? (
                  <>
                    <CheckIcon className="size-3.5 text-emerald-500" aria-hidden />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" aria-hidden />
                    <span>Copy Amount</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Unique Plisio Deposit Address */}
          <div className="space-y-1">
            <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
              2. UNIQUE PLISIO {invoice.code} ({invoice.networkTag}) DEPOSIT ADDRESS
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                data-testid={`${testIdPrefix}-address`}
                className="flex h-11 flex-1 items-center overflow-x-auto rounded-xl border border-border/80 bg-muted/35 px-3.5 font-mono text-xs font-bold text-foreground"
              >
                {invoice.walletAddress}
              </div>
              <button
                type="button"
                onClick={() => void copyValue(invoice.walletAddress, "address")}
                data-testid={`${testIdPrefix}-copy-address`}
                className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-(--button) bg-[image:var(--button-image)] px-4 text-xs font-extrabold text-(--button-foreground) shadow-xs transition-opacity hover:opacity-95"
              >
                {copiedField === "address" ? (
                  <>
                    <CheckIcon className="size-3.5 stroke-[2.5]" aria-hidden />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" aria-hidden />
                    <span>Copy Address</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Action Buttons: Check Status + Confirm Payment (Auto-Verify) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border/80 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={checking || simulating}
            onClick={() => void checkStatus(true)}
            data-testid={`${testIdPrefix}-check-status`}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            <RefreshCwIcon
              className={cn("size-3.5", checking && "animate-spin")}
              aria-hidden
            />
            <span>{checking ? "Checking Blockchain…" : "Check Payment Status"}</span>
          </button>

          {invoice.invoiceUrl && (
            <a
              href={invoice.invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Plisio Invoice</span>
              <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          )}
        </div>

        <button
          type="button"
          disabled={simulating || checking}
          onClick={() => void handleSimulateConfirm()}
          data-testid={`${testIdPrefix}-confirm-payment`}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-md transition-all hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-60 sm:text-sm"
        >
          {simulating ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              <span>Verifying Payment…</span>
            </>
          ) : (
            <>
              <CheckCircle2Icon className="size-4" aria-hidden />
              <span>I Have Sent Payment · Auto-Verify Now</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
