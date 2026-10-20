"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  AwardIcon,
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlameIcon,
  GlobeIcon,
  LockIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { placeOrder } from "@/app/(store)/checkout/actions";
import {
  DEFAULT_CRYPTO_PROTOCOLS,
  shortNetworkTag,
  type CryptoProtocol,
} from "@/lib/crypto-protocols";
import { parseProductFeatures } from "@/lib/home-sections";
import { formatMoney } from "@/lib/money";
import {
  getPlisioCurrency,
  PLISIO_CURRENCIES,
  type PlisioInvoiceSession,
} from "@/lib/plisio";
import { generateQrMatrix } from "@/lib/qr-code";
import { resolveQuickCheckoutTiers, type QuickCheckoutTier } from "@/lib/quick-checkout";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";
import { PlisioCoinSelector, PlisioLiveInvoiceConsole } from "./plisio-payment-console";

const PENDING_QC_STORAGE_KEY = "woo_pending_quick_checkout";

type QuickCheckoutCustomer = {
  fullName: string;
  email: string;
  phone?: string;
};

type QuickCheckoutPayment = {
  codEnabled: boolean;
  plisioEnabled?: boolean;
  cryptoEnabled: boolean;
  cryptoProtocols: CryptoProtocol[];
};

type QuickCheckoutPayload = {
  authenticated?: boolean;
  storeName?: string;
  customer?: QuickCheckoutCustomer;
  payment?: QuickCheckoutPayment;
  products?: Product[];
};

const STEPS = [
  { num: 1, label: "1. Package" },
  { num: 2, label: "2. Contact" },
  { num: 3, label: "3. Payment" },
  { num: 4, label: "4. Verify" },
] as const;

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "United Arab Emirates",
  "Bangladesh",
  "India",
  "Other",
] as const;

function storeInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return (name.slice(0, 2) || "WS").toUpperCase();
}

function productSubtitleText(product: Product, index: number): string {
  const feats = parseProductFeatures(product.features, 2);
  if (feats.length > 0) {
    return feats.join(" · ");
  }
  if (product.brand && product.category?.name) {
    return `${product.brand} · ${product.category.name}`;
  }
  if (product.brand) {
    return `${product.brand} · Official Warranty`;
  }
  const defaults = [
    "Best Seller · Fast Dispatch",
    "100% Verified Authentic",
    "Global Warranty · Best Value",
    "Top Rated · High Demand",
    "Premium Grade · Ready to Ship",
    "Lowest Price · High Volume",
  ];
  return defaults[index % defaults.length];
}

function ProductBadgeIcon({ index }: { index: number }) {
  const mod = index % 6;
  if (mod === 0) return <FlameIcon className="size-3.5 shrink-0 text-amber-500" aria-hidden />;
  if (mod === 1)
    return <ShieldCheckIcon className="size-3.5 shrink-0 text-sky-500" aria-hidden />;
  if (mod === 2) return <GlobeIcon className="size-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (mod === 3)
    return <StarIcon className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden />;
  if (mod === 4) return <AwardIcon className="size-3.5 shrink-0 text-primary" aria-hidden />;
  return <ZapIcon className="size-3.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden />;
}

/** Real ISO/IEC 18004 scannable QR code SVG rendered offline without external network calls. */
function DepositQrCodeSvg({ value }: { value: string }) {
  const cells = generateQrMatrix(value);
  const size = cells.length;
  const quietZone = 2;
  const totalSize = size + quietZone * 2;

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      className="size-24 shrink-0 text-zinc-950"
      shapeRendering="crispEdges"
      aria-label="Deposit address QR code"
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

function buildLoginRedirectUrl(productId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("quickCheckout", productId);
  const nextPath = `${url.pathname}${url.search}`;
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function QuickCheckoutModal({
  initialProduct,
  initialData,
  onClose,
}: {
  initialProduct: Product;
  initialData?: QuickCheckoutPayload | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const money = useMoney();
  const [storeName, setStoreName] = useState<string>(
    initialData?.storeName || "Woo Solution",
  );
  const [products, setProducts] = useState<Product[]>(
    initialData?.products && initialData.products.length > 0
      ? initialData.products
      : [initialProduct],
  );
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProduct.id);
  const [selectedTierByProduct, setSelectedTierByProduct] = useState<Record<string, string>>({});

  // Step navigation & step gating: customer cannot advance until previous step is passed
  const [step, setStep] = useState<number>(1);
  const [maxUnlockedStep, setMaxUnlockedStep] = useState<number>(1);

  // Step 2: Contact Details state (auto-populated from authenticated user)
  const [fullName, setFullName] = useState<string>(initialData?.customer?.fullName ?? "");
  const [email, setEmail] = useState<string>(initialData?.customer?.email ?? "");
  const [telegram, setTelegram] = useState<string>("");
  const [whatsapp, setWhatsapp] = useState<string>(initialData?.customer?.phone ?? "");
  const [country, setCountry] = useState<string>("United States");
  const [notes, setNotes] = useState<string>("");
  const [contactErrors, setContactErrors] = useState<{ fullName?: string; email?: string }>({});

  // Step 3: Payment state
  const [paymentConfig, setPaymentConfig] = useState<QuickCheckoutPayment>(
    initialData?.payment ?? {
      codEnabled: true,
      plisioEnabled: false,
      cryptoEnabled: true,
      cryptoProtocols: DEFAULT_CRYPTO_PROTOCOLS,
    },
  );
  const [paymentMode, setPaymentMode] = useState<"crypto" | "plisio" | "cod">(() => {
    const p = initialData?.payment;
    if (p?.plisioEnabled) return "plisio";
    if (p && (!p.cryptoEnabled || p.cryptoProtocols.length === 0) && p.codEnabled) {
      return "cod";
    }
    return "crypto";
  });
  const [selectedPlisioCid, setSelectedPlisioCid] = useState<string>(
    PLISIO_CURRENCIES[0].cid,
  );
  const [plisioInvoice, setPlisioInvoice] = useState<PlisioInvoiceSession | null>(
    null,
  );
  const [plisioConfirmedTxId, setPlisioConfirmedTxId] = useState<string | null>(
    null,
  );
  const [selectedProtocolId, setSelectedProtocolId] = useState<string>("");
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  // Step 4: Payment Verification & Thank You state
  const [txId, setTxId] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialData?.products &&
      initialData.products.length > 0 &&
      initialData.customer &&
      initialData.payment
    ) {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ productId: initialProduct.id });
    const cid = initialProduct.category_id ?? initialProduct.category?.id;
    if (cid) params.set("categoryId", cid);

    fetch(`/api/quick-checkout?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) {
            try {
              sessionStorage.setItem(PENDING_QC_STORAGE_KEY, initialProduct.id);
            } catch {
              // ignore storage errors
            }
            onClose();
            router.push(buildLoginRedirectUrl(initialProduct.id));
          }
          return null;
        }
        return res.ok ? ((await res.json()) as QuickCheckoutPayload) : null;
      })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.storeName) setStoreName(data.storeName);
        if (Array.isArray(data.products) && data.products.length > 0) {
          setProducts(data.products);
        }
        if (data.customer) {
          setFullName((prev) => prev || data.customer?.fullName || "");
          setEmail((prev) => prev || data.customer?.email || "");
          setWhatsapp((prev) => prev || data.customer?.phone || "");
        }
        if (data.payment) {
          setPaymentConfig(data.payment);
          if (data.payment.plisioEnabled) {
            setPaymentMode("plisio");
          } else if (
            (!data.payment.cryptoEnabled ||
              data.payment.cryptoProtocols.length === 0) &&
            data.payment.codEnabled
          ) {
            setPaymentMode("cod");
          }
        }
      })
      .catch(() => {
        // Keep initialProduct fallback if network fails
      });

    return () => {
      cancelled = true;
    };
  }, [
    initialData,
    initialProduct.id,
    initialProduct.category_id,
    initialProduct.category?.id,
    onClose,
    router,
  ]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const selectedProduct =
    products.find((p) => p.id === selectedProductId) ?? products[0] ?? initialProduct;
  const tiers: QuickCheckoutTier[] = resolveQuickCheckoutTiers(selectedProduct);

  // Default to the 5x tier or 2nd tier when multiple tiers exist, or the stored selection
  const preferredDefaultTier =
    tiers.find((t) => t.quantity === 5) ?? tiers[Math.min(1, tiers.length - 1)] ?? tiers[0];
  const activeTierId = selectedTierByProduct[selectedProduct.id] ?? preferredDefaultTier?.id;
  const selectedTier = tiers.find((t) => t.id === activeTierId) ?? preferredDefaultTier ?? tiers[0];

  const activeProtocols = paymentConfig.cryptoProtocols;
  const defaultProtocol =
    activeProtocols.find((p) => Boolean(p.badge)) ?? activeProtocols[0];
  const selectedProtocol =
    activeProtocols.find((p) => p.id === selectedProtocolId) ?? defaultProtocol;

  // Count how many times each coin code appears so duplicate codes (e.g. USDT on TRC20/ERC20/BEP20) show network subtitle
  const codeCounts = activeProtocols.reduce<Record<string, number>>((acc, p) => {
    acc[p.code] = (acc[p.code] ?? 0) + 1;
    return acc;
  }, {});

  const categoryTitle = selectedProduct.category?.name
    ? `SELECT ${selectedProduct.category.name.toUpperCase()} PRODUCT`
    : "SELECT VERIFIED PRODUCT";

  function handlePassStep1() {
    if (!selectedProduct || !selectedTier) return;
    setMaxUnlockedStep((prev) => Math.max(prev, 2));
    setStep(2);
  }

  function handleContinueToPayment() {
    const errs: { fullName?: string; email?: string } = {};
    if (!fullName.trim()) {
      errs.fullName = "Full name is required.";
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "Enter a valid delivery email address.";
    }
    setContactErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setMaxUnlockedStep((prev) => Math.max(prev, 3));
    setStep(3);
  }

  async function handleCopyDepositAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(true);
      toast.success("Deposit address copied to clipboard.");
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      toast.error("Could not copy automatically — please select and copy the address.");
    }
  }

  const selectedPlisioCurrency = getPlisioCurrency(selectedPlisioCid);

  async function handleProceedFromStep3() {
    setVerifyError(null);
    if (paymentMode === "plisio") {
      if (!selectedProduct || !selectedTier || submitting) return;
      setSubmitting(true);
      try {
        if (plisioInvoice && plisioInvoice.orderId) {
          // If customer changed coin on an already created Plisio order, refresh invoice
          const res = await fetch("/api/plisio/invoice", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              orderId: plisioInvoice.orderId,
              cid: selectedPlisioCurrency.cid,
            }),
          });
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            invoice?: PlisioInvoiceSession;
            error?: string;
          } | null;
          if (data?.ok && data.invoice) {
            setPlisioInvoice(data.invoice);
          }
          setMaxUnlockedStep((prev) => Math.max(prev, 4));
          setStep(4);
          return;
        }

        const fallbackVariationId =
          selectedTier.variationId ??
          (selectedProduct.type === "variable"
            ? (selectedProduct.variations?.find((v) => v.is_active !== false)?.id ?? null)
            : null);
        const itemQty = selectedTier.variationId
          ? 1
          : Math.max(1, selectedTier.quantity);

        const res = await placeOrder({
          items: [
            {
              product_id: selectedProduct.id,
              variation_id: fallbackVariationId,
              quantity: itemQty,
            },
          ],
          shipping: {
            name: fullName.trim() || "Customer",
            phone: whatsapp.trim(),
            address_line1: email.trim()
              ? `Delivery Email: ${email.trim()}`
              : "Quick Checkout Delivery",
            address_line2: telegram.trim() ? `Telegram: ${telegram.trim()}` : "",
            city: country.trim() || "Online",
            postal_code: "",
            country: country.trim() || "United States",
            notes: notes.trim(),
          },
          payment: {
            method: "plisio",
            gateway: "plisio",
            plisioCid: selectedPlisioCurrency.cid,
            protocolCode: selectedPlisioCurrency.code,
            protocolName: `${selectedPlisioCurrency.name} · Plisio`,
            network: selectedPlisioCurrency.network,
          },
        });

        if (!res.ok) {
          toast.error(res.error);
          return;
        }

        if (res.plisioInvoice) {
          setPlisioInvoice(res.plisioInvoice);
        }
        setMaxUnlockedStep((prev) => Math.max(prev, 4));
        setStep(4);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setMaxUnlockedStep((prev) => Math.max(prev, 4));
    setStep(4);
  }

  async function handleSubmitOrder() {
    if (!selectedProduct || !selectedTier || submitting) return;
    setVerifyError(null);

    if (paymentMode === "crypto") {
      if (!selectedProtocol) {
        setVerifyError("Please select a crypto wallet protocol in Step 3.");
        return;
      }
      if (!txId.trim()) {
        setVerifyError(
          "Please enter your Transaction ID (TXID) so the Admin can verify your payment.",
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const fallbackVariationId =
        selectedTier.variationId ??
        (selectedProduct.type === "variable"
          ? (selectedProduct.variations?.find((v) => v.is_active !== false)?.id ?? null)
          : null);
      const itemQty = selectedTier.variationId ? 1 : Math.max(1, selectedTier.quantity);

      const res = await placeOrder({
        items: [
          {
            product_id: selectedProduct.id,
            variation_id: fallbackVariationId,
            quantity: itemQty,
          },
        ],
        shipping: {
          name: fullName.trim() || "Customer",
          phone: whatsapp.trim(),
          address_line1: email.trim()
            ? `Delivery Email: ${email.trim()}`
            : "Quick Checkout Delivery",
          address_line2: telegram.trim() ? `Telegram: ${telegram.trim()}` : "",
          city: country.trim() || "Online",
          postal_code: "",
          country: country.trim() || "United States",
          notes: notes.trim(),
        },
        payment:
          paymentMode === "crypto" && selectedProtocol
            ? {
                method: "crypto",
                protocolCode: selectedProtocol.code,
                protocolName: selectedProtocol.name,
                network: selectedProtocol.network,
                depositAddress: selectedProtocol.address,
                transactionId: txId.trim(),
              }
            : { method: "cod" },
      });

      if (!res.ok) {
        setVerifyError(res.error);
        return;
      }

      setSubmittedOrderId(res.orderId);
      toast.success("Order submitted! Thank you for your purchase.");
    } catch (e) {
      setVerifyError(
        e instanceof Error ? e.message : "Failed to submit order. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-xs animate-in fade-in-0 duration-150 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="quick-checkout-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${storeName} Order Portal`}
        data-testid="quick-checkout-modal"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border/80 bg-card text-card-foreground shadow-2xl animate-in zoom-in-95 duration-150"
      >
        {/* ── Top Portal Header Bar ──────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 bg-slate-900 px-6 py-4 text-white dark:bg-zinc-950">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-(--button) bg-[image:var(--button-image)] text-sm font-black tracking-tight text-(--button-foreground) shadow-md">
              {storeInitials(storeName)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="truncate text-lg font-extrabold tracking-tight text-white sm:text-xl">
                  {storeName} Order Portal
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                  <LockIcon className="size-3" aria-hidden />
                  SSL Verified
                </span>
              </div>
              <p className="truncate text-xs text-slate-300/85">
                Fast &amp; secure express order checkout
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Checkout"
            data-testid="quick-checkout-close"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white"
          >
            <XIcon className="size-4.5" />
          </button>
        </div>

        {/* ── 4-Step Progress Bar ────────────────────────────────────────── */}
        <div className="border-b border-border/80 bg-muted/30 px-6 py-3.5">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
            {STEPS.map((s) => {
              const completed = Boolean(submittedOrderId) || step > s.num;
              const active = !submittedOrderId && step === s.num;
              const canNavigate = !submittedOrderId && s.num <= maxUnlockedStep;
              return (
                <button
                  key={s.num}
                  type="button"
                  disabled={!canNavigate}
                  onClick={() => {
                    if (canNavigate) setStep(s.num);
                  }}
                  data-testid={`quick-checkout-step-${s.num}`}
                  data-state={completed ? "completed" : active ? "active" : "locked"}
                  className={cn(
                    "flex items-center gap-2 text-xs font-bold transition-colors sm:text-sm",
                    canNavigate ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold transition-all",
                      completed
                        ? "bg-emerald-500 text-white shadow-xs"
                        : active
                          ? "bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground) shadow-xs"
                          : "bg-muted-foreground/20 text-muted-foreground",
                    )}
                  >
                    {completed ? (
                      <CheckIcon className="size-3.5 stroke-[3]" aria-hidden />
                    ) : (
                      s.num
                    )}
                  </span>
                  <span
                    className={cn(
                      completed
                        ? "text-emerald-600 dark:text-emerald-400"
                        : active
                          ? "text-primary"
                          : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable Modal Content ───────────────────────────────────── */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {submittedOrderId && selectedTier ? (
            <div
              className="space-y-6 py-2 text-center"
              data-testid="quick-checkout-thank-you"
            >
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CircleCheckIcon className="size-9 stroke-[2.2]" aria-hidden />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                  {paymentMode === "plisio"
                    ? "Thank You! Payment Verified & Order Processing."
                    : "Thank You! Your Order Has Been Submitted."}
                </h3>
                <p className="mx-auto max-w-lg text-xs text-muted-foreground sm:text-sm">
                  {paymentMode === "plisio"
                    ? "Plisio verified your blockchain payment automatically. Your order status is now Paid & Processing."
                    : paymentMode === "crypto"
                      ? "Your Transaction ID (TXID) has been sent to the Admin for payment verification."
                      : "Your Cash on Delivery order has been received and will be processed shortly."}
                </p>
              </div>

              {/* Order Summary Card */}
              <div className="mx-auto max-w-xl space-y-2.5 rounded-2xl border border-border/80 bg-muted/25 p-5 text-left text-xs sm:text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-muted-foreground">Order Summary:</span>
                  <span className="font-extrabold text-foreground">
                    {selectedTier.title} {selectedProduct.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Payment Protocol:</span>
                  <span className="font-semibold text-foreground">
                    {paymentMode === "plisio"
                      ? `${selectedPlisioCurrency.name} · Plisio (${selectedPlisioCurrency.network})`
                      : paymentMode === "crypto" && selectedProtocol
                        ? `${selectedProtocol.name} (${shortNetworkTag(selectedProtocol.network)}) (${selectedProtocol.network})`
                        : "Cash on Delivery (COD)"}
                  </span>
                </div>
                {paymentMode === "plisio" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Payment &amp; Order Status:</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        data-testid="qc-thank-you-payment-status"
                        className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-600 uppercase dark:text-emerald-400"
                      >
                        Paid
                      </span>
                      <span
                        data-testid="qc-thank-you-order-status"
                        className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-sky-600 uppercase dark:text-sky-400"
                      >
                        Processing
                      </span>
                    </div>
                  </div>
                )}
                {((paymentMode === "crypto" && txId.trim()) ||
                  (paymentMode === "plisio" && plisioConfirmedTxId)) && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Transaction ID (TXID):</span>
                    <span
                      className="max-w-[260px] truncate font-mono text-xs font-bold text-foreground"
                      title={
                        paymentMode === "plisio"
                          ? (plisioConfirmedTxId ?? "")
                          : txId.trim()
                      }
                    >
                      {paymentMode === "plisio" ? plisioConfirmedTxId : txId.trim()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 border-t border-border/80 pt-2.5 text-sm font-extrabold sm:text-base">
                  <span className="text-primary">
                    {paymentMode === "crypto" || paymentMode === "plisio"
                      ? "Total Paid:"
                      : "Total Due:"}
                  </span>
                  <span className="text-primary tabular-nums">
                    {formatMoney(selectedTier.priceMicros, money)} {money.currency}
                  </span>
                </div>
              </div>

              {/* Action Buttons: View Order Details | Close */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(`/orders/${submittedOrderId}?placed=1`);
                  }}
                  data-testid="qc-thank-you-view-order"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-(--button) bg-[image:var(--button-image)] px-6 py-3 text-xs font-extrabold text-(--button-foreground) shadow-md transition-opacity hover:opacity-95 sm:text-sm"
                >
                  <span>View Order Details</span>
                  <ExternalLinkIcon className="size-4" aria-hidden />
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  data-testid="qc-thank-you-close"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-border/80 bg-card px-6 py-3 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                >
                  <span>Close</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {step === 1 && (
                <>
                  {/* 1. Product Selector (Clicked Product + Same-Category Products) */}
                  <div className="space-y-3">
                    <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                      {categoryTitle}
                    </p>

                    <div
                      className="grid gap-3 sm:grid-cols-2"
                      data-testid="quick-checkout-product-list"
                    >
                      {products.map((item, idx) => {
                        const isSelected = item.id === selectedProduct.id;
                        const itemTiers = resolveQuickCheckoutTiers(item);
                        const lowestMicros =
                          itemTiers.length > 0
                            ? Math.min(...itemTiers.map((t) => t.priceMicros))
                            : item.price_micros;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedProductId(item.id)}
                            data-testid={`quick-checkout-product-option-${item.slug}`}
                            data-selected={isSelected ? "true" : "false"}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all",
                              isSelected
                                ? "border-2 border-primary bg-primary/[0.05] shadow-xs ring-2 ring-primary/15"
                                : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
                            )}
                          >
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-extrabold text-foreground sm:text-base">
                                {item.name}
                              </p>
                              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                <ProductBadgeIcon index={idx} />
                                <span className="truncate">
                                  {productSubtitleText(item, idx)}
                                </span>
                              </p>
                            </div>

                            <span className="shrink-0 text-xs font-extrabold text-primary tabular-nums sm:text-sm">
                              From {formatMoney(lowestMicros, money)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Dynamic Quantity Tier Selector */}
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                        SELECT QUANTITY TIER ({selectedProduct.name.toUpperCase()})
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        <SparklesIcon className="size-3" aria-hidden />
                        Instant Tier Pricing
                      </span>
                    </div>

                    <div
                      className={cn(
                        "grid gap-2.5 pt-1",
                        tiers.length <= 5
                          ? "grid-cols-2 sm:grid-cols-5"
                          : "grid-cols-2 sm:grid-cols-4 md:grid-cols-7",
                      )}
                      data-testid="quick-checkout-tier-list"
                    >
                      {tiers.map((tier) => {
                        const isSelected = selectedTier?.id === tier.id;
                        return (
                          <button
                            key={tier.id}
                            type="button"
                            onClick={() =>
                              setSelectedTierByProduct((prev) => ({
                                ...prev,
                                [selectedProduct.id]: tier.id,
                              }))
                            }
                            data-testid={`quick-checkout-tier-${tier.quantity}`}
                            data-selected={isSelected ? "true" : "false"}
                            className={cn(
                              "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border px-2.5 py-4 text-center transition-all",
                              isSelected
                                ? "border-transparent bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground) shadow-lg ring-2 ring-primary/35 -translate-y-0.5"
                                : "border-border/80 bg-card text-foreground hover:border-primary/45 hover:bg-muted/25",
                            )}
                          >
                            {tier.popular && (
                              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-black tracking-wider text-zinc-950 uppercase shadow-xs">
                                POPULAR
                              </span>
                            )}

                            <span className="text-lg font-black tracking-tight tabular-nums sm:text-xl">
                              {tier.title}
                            </span>

                            <span
                              className={cn(
                                "mt-0.5 text-xs font-extrabold tabular-nums sm:text-sm",
                                isSelected ? "text-(--button-foreground)" : "text-primary",
                              )}
                            >
                              {formatMoney(tier.priceMicros, money)}
                            </span>

                            <span
                              className={cn(
                                "mt-1 line-clamp-1 text-[10px] font-medium",
                                isSelected
                                  ? "text-(--button-foreground)/85"
                                  : "text-muted-foreground",
                              )}
                            >
                              {tier.subtitle}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3. Selected Package & Final Price Summary Card */}
                  {selectedTier && (
                    <div
                      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-muted/25 px-5 py-4"
                      data-testid="quick-checkout-summary"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Selected Package:
                        </p>
                        <p
                          className="truncate text-base font-extrabold text-foreground sm:text-lg"
                          data-testid="quick-checkout-summary-package"
                        >
                          {selectedProduct.name} ({selectedTier.quantity}{" "}
                          {selectedTier.quantity === 1 ? "Unit" : "Units"})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Estimated Unit Cost: {formatMoney(selectedTier.unitPriceMicros, money)}
                          /unit
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs font-medium text-muted-foreground">Total Due:</p>
                        <p
                          className="text-2xl font-black tracking-tight text-primary tabular-nums sm:text-3xl"
                          data-testid="quick-checkout-total-due"
                        >
                          {formatMoney(selectedTier.priceMicros, money)} {money.currency}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 4. Bottom Action Bar */}
                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="button"
                      onClick={handlePassStep1}
                      data-testid="quick-checkout-continue"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-(--button) bg-[image:var(--button-image)] px-7 py-3.5 text-sm font-extrabold text-(--button-foreground) shadow-lg transition-all hover:opacity-95 active:scale-[0.99]"
                    >
                      <span>Continue to Contact Details</span>
                      <ArrowRightIcon className="size-4" aria-hidden />
                    </button>
                  </div>
                </>
              )}

              {step === 2 && (
                <div className="space-y-5" data-testid="quick-checkout-step-2-panel">
                  {/* Top Privacy / Delivery Notice Banner */}
                  <div
                    className="flex items-center gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.08] px-4 py-3 text-xs font-medium text-sky-700 dark:text-sky-300 sm:text-sm"
                    data-testid="quick-checkout-contact-notice"
                  >
                    <ShieldCheckIcon
                      className="size-4.5 shrink-0 text-sky-600 dark:text-sky-400"
                      aria-hidden
                    />
                    <span>
                      Your contact details are strictly used for order delivery and order
                      notifications.
                    </span>
                  </div>

                  {/* 2-Column Contact Form Grid */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* 1. Full Name */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-full-name"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        FULL NAME *
                      </label>
                      <input
                        id="qc-full-name"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (contactErrors.fullName) {
                            setContactErrors((prev) => ({ ...prev, fullName: undefined }));
                          }
                        }}
                        placeholder="e.g. Alexander Vance"
                        data-testid="qc-contact-full-name"
                        className={cn(
                          "h-11 w-full rounded-xl border bg-muted/20 px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20",
                          contactErrors.fullName ? "border-destructive" : "border-border/80",
                        )}
                      />
                      {contactErrors.fullName && (
                        <p className="text-xs font-medium text-destructive">
                          {contactErrors.fullName}
                        </p>
                      )}
                    </div>

                    {/* 2. Email Address (For Delivery) */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-email"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        EMAIL ADDRESS * (FOR DELIVERY)
                      </label>
                      <input
                        id="qc-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (contactErrors.email) {
                            setContactErrors((prev) => ({ ...prev, email: undefined }));
                          }
                        }}
                        placeholder="e.g. alex@scaleagency.io"
                        data-testid="qc-contact-email"
                        className={cn(
                          "h-11 w-full rounded-xl border bg-muted/20 px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20",
                          contactErrors.email ? "border-destructive" : "border-border/80",
                        )}
                      />
                      {contactErrors.email && (
                        <p className="text-xs font-medium text-destructive">
                          {contactErrors.email}
                        </p>
                      )}
                    </div>

                    {/* 3. Telegram Username (Optional) */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-telegram"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        TELEGRAM USERNAME (OPTIONAL)
                      </label>
                      <input
                        id="qc-telegram"
                        type="text"
                        value={telegram}
                        onChange={(e) => setTelegram(e.target.value)}
                        placeholder="e.g. @vance_scale (Optional)"
                        data-testid="qc-contact-telegram"
                        className="h-11 w-full rounded-xl border border-border/80 bg-muted/20 px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* 4. WhatsApp Number (Optional) */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-whatsapp"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        WHATSAPP NUMBER (OPTIONAL)
                      </label>
                      <input
                        id="qc-whatsapp"
                        type="tel"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        placeholder="e.g. +1 (415) 892-3341 (Optional)"
                        data-testid="qc-contact-whatsapp"
                        className="h-11 w-full rounded-xl border border-border/80 bg-muted/20 px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* 5. Country / Jurisdiction */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-country"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        COUNTRY / JURISDICTION
                      </label>
                      <div className="relative">
                        <select
                          id="qc-country"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                          data-testid="qc-contact-country"
                          className="h-11 w-full appearance-none rounded-xl border border-border/80 bg-muted/20 pr-9 pl-3.5 text-sm font-medium text-foreground transition-colors outline-none focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
                        >
                          {COUNTRIES.map((c) => (
                            <option key={c} value={c} className="bg-card text-foreground">
                              {c}
                            </option>
                          ))}
                        </select>
                        <ChevronDownIcon
                          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                    </div>

                    {/* 6. Order Notes / Custom Requests (Optional) */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="qc-notes"
                        className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                      >
                        ORDER NOTES / CUSTOM REQUESTS (OPTIONAL)
                      </label>
                      <input
                        id="qc-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. Need NY or TX state IP profiles only"
                        data-testid="qc-contact-notes"
                        className="h-11 w-full rounded-xl border border-border/80 bg-muted/20 px-3.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  {/* Bottom Action Bar: ← Back | Select Payment Method → */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      data-testid="quick-checkout-back-to-step-1"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-2.5 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                    >
                      <ArrowLeftIcon className="size-4" aria-hidden />
                      <span>Back</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleContinueToPayment}
                      data-testid="quick-checkout-select-payment"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-(--button) bg-[image:var(--button-image)] px-7 py-3.5 text-sm font-extrabold text-(--button-foreground) shadow-lg transition-all hover:opacity-95 active:scale-[0.99]"
                    >
                      <span>Select Payment Method</span>
                      <ArrowRightIcon className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && selectedTier && (
                <div className="space-y-5" data-testid="quick-checkout-step-3-panel">
                  {/* 1. Cash on Delivery Option on Top (when enabled) */}
                  {paymentConfig.codEnabled && (
                    <div className="space-y-2.5" data-testid="qc-cod-section">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                          CASH ON DELIVERY
                        </p>
                        {!paymentConfig.cryptoEnabled && (
                          <p
                            className="text-xs font-extrabold text-primary tabular-nums sm:text-sm"
                            data-testid="qc-payment-total-due"
                          >
                            Total Due: {formatMoney(selectedTier.priceMicros, money)}{" "}
                            {money.currency}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setPaymentMode("cod")}
                        data-testid="qc-cod-option"
                        data-selected={paymentMode === "cod" ? "true" : "false"}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all",
                          paymentMode === "cod"
                            ? "border-2 border-primary bg-primary/[0.06] shadow-xs ring-2 ring-primary/15"
                            : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3.5">
                          <span
                            className={cn(
                              "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
                              paymentMode === "cod"
                                ? "bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground)"
                                : "bg-primary/10 text-primary",
                            )}
                          >
                            <BanknoteIcon className="size-5" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-extrabold text-foreground sm:text-base">
                              Cash on Delivery (COD)
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              Pay in cash when your order is delivered
                            </p>
                          </div>
                        </div>

                        <span className="shrink-0 text-xs font-extrabold text-primary tabular-nums sm:text-sm">
                          {formatMoney(selectedTier.priceMicros, money)} {money.currency}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* 2. Plisio Automated Crypto Gateway Option (when enabled) */}
                  {paymentConfig.plisioEnabled && (
                    <PlisioCoinSelector
                      selectedCid={selectedPlisioCid}
                      active={paymentMode === "plisio"}
                      totalMicros={selectedTier.priceMicros}
                      formattedStoreTotal={`${formatMoney(selectedTier.priceMicros, money)} ${money.currency}`}
                      onSelectCoin={(coin) => {
                        setPaymentMode("plisio");
                        setSelectedPlisioCid(coin.cid);
                      }}
                      testIdPrefix="qc-plisio"
                    />
                  )}

                  {/* 3. Manual Crypto Options Below Plisio / COD */}
                  {paymentConfig.cryptoEnabled && selectedProtocol && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-extrabold tracking-wider text-muted-foreground uppercase">
                          SELECT CRYPTO WALLET PROTOCOL
                        </p>
                        <p
                          className="text-xs font-extrabold text-primary tabular-nums sm:text-sm"
                          data-testid="qc-payment-total-due"
                        >
                          Total Due: {formatMoney(selectedTier.priceMicros, money)} {money.currency}
                        </p>
                      </div>

                      {/* Crypto Protocol Grid */}
                      <div
                        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
                        data-testid="qc-crypto-protocol-grid"
                      >
                        {activeProtocols.map((proto) => {
                          const isSelected =
                            paymentMode === "crypto" && proto.id === selectedProtocol.id;
                          const showNetworkSuffix = (codeCounts[proto.code] ?? 0) > 1;
                          const netShort = shortNetworkTag(proto.network);
                          return (
                            <button
                              key={proto.id}
                              type="button"
                              onClick={() => {
                                setPaymentMode("crypto");
                                setSelectedProtocolId(proto.id);
                              }}
                              data-testid={`qc-crypto-option-${proto.id}`}
                              data-selected={isSelected ? "true" : "false"}
                              className={cn(
                                "flex cursor-pointer flex-col items-center justify-center rounded-2xl border px-3 py-2.5 text-center transition-all",
                                isSelected
                                  ? "border-2 border-primary bg-primary/[0.06] shadow-xs ring-2 ring-primary/15"
                                  : "border-border/80 bg-card hover:border-primary/40 hover:bg-muted/25",
                              )}
                            >
                              <span className="text-sm font-black tracking-tight text-foreground sm:text-base">
                                {proto.code}
                              </span>
                              <span
                                className={cn(
                                  "mt-0.5 line-clamp-1 text-[11px]",
                                  isSelected
                                    ? "font-bold text-foreground/85"
                                    : "text-muted-foreground",
                                )}
                              >
                                {showNetworkSuffix ? `${proto.name} (${netShort})` : proto.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Selected Protocol Deposit Card */}
                      {paymentMode === "crypto" && (
                        <div
                          className="space-y-4 rounded-2xl border border-primary/25 bg-card p-5 shadow-xs"
                          data-testid="qc-crypto-deposit-box"
                        >
                          {/* Header: Protocol Name + Badge | Amount to Send */}
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-extrabold tracking-tight text-foreground sm:text-lg">
                                  {selectedProtocol.name} (
                                  {shortNetworkTag(selectedProtocol.network)})
                                </h3>
                                {selectedProtocol.badge && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-(--button) bg-[image:var(--button-image)] px-2.5 py-0.5 text-[11px] font-extrabold text-(--button-foreground) shadow-2xs">
                                    <FlameIcon className="size-3 fill-current" aria-hidden />
                                    {selectedProtocol.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Network:{" "}
                                <strong className="font-bold text-foreground">
                                  {selectedProtocol.network}
                                </strong>
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="text-xs font-medium text-muted-foreground">
                                Amount to Send:
                              </p>
                              <p className="text-lg font-black tracking-tight text-primary tabular-nums sm:text-2xl">
                                {formatMoney(selectedTier.priceMicros, money)} {money.currency}{" "}
                                equivalent
                              </p>
                            </div>
                          </div>

                          {/* Deposit Address + Copy Button */}
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
                              OFFICIAL {storeName.toUpperCase()} {selectedProtocol.code} DEPOSIT
                              ADDRESS:
                            </p>
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                              <div
                                data-testid="qc-deposit-address"
                                className="flex h-12 flex-1 items-center overflow-x-auto rounded-xl border border-border/80 bg-muted/35 px-4 font-mono text-xs font-bold text-foreground sm:text-sm"
                              >
                                {selectedProtocol.address}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyDepositAddress(selectedProtocol.address)
                                }
                                data-testid="qc-copy-address"
                                className="inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-(--button) bg-[image:var(--button-image)] px-5 text-xs font-extrabold text-(--button-foreground) shadow-sm transition-opacity hover:opacity-95 sm:text-sm"
                              >
                                {copiedAddress ? (
                                  <>
                                    <CheckIcon className="size-4 stroke-[2.5]" aria-hidden />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="size-4" aria-hidden />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* QR Code + Live Scanner Instructions */}
                          <div className="flex flex-col items-center gap-5 pt-1 sm:flex-row sm:items-center">
                            <div className="flex flex-col items-center rounded-2xl border border-border/80 bg-white p-3 shadow-xs">
                              <DepositQrCodeSvg value={selectedProtocol.address} />
                              <span className="mt-1.5 text-[9px] font-black tracking-wider text-zinc-900 uppercase">
                                SCAN TO DEPOSIT
                              </span>
                            </div>

                            <div className="flex-1 space-y-2 text-xs leading-relaxed">
                              <p className="flex items-center gap-1.5 font-extrabold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                                <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
                                <span>LIVE SCANNER READY:</span>
                              </p>
                              <p className="text-muted-foreground">
                                Point your crypto wallet app camera (Binance, Trust Wallet,
                                MetaMask, Coinbase) at this QR code to automatically scan and
                                deposit{" "}
                                <strong className="font-extrabold text-foreground">
                                  {selectedProtocol.code}
                                </strong>{" "}
                                via{" "}
                                <strong className="font-extrabold text-foreground">
                                  {selectedProtocol.network}
                                </strong>
                                .
                              </p>
                              <p className="font-semibold text-primary">
                                ⚠️ Always verify the first 4 and last 4 characters of the scanned
                                address before sending funds.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Bottom Action Bar: ← Back | I Have Sent Payment → Upload Hash */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      data-testid="quick-checkout-back-to-step-2"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-2.5 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                    >
                      <ArrowLeftIcon className="size-4" aria-hidden />
                      <span>Back</span>
                    </button>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleProceedFromStep3()}
                      data-testid="quick-checkout-sent-payment"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-(--button) bg-[image:var(--button-image)] px-7 py-3.5 text-sm font-extrabold text-(--button-foreground) shadow-lg transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                    >
                      <span>
                        {paymentMode === "plisio"
                          ? submitting
                            ? "Generating Plisio Invoice…"
                            : "Continue to Plisio Auto-Pay →"
                          : paymentMode === "cod"
                            ? "Confirm Cash on Delivery → Verify"
                            : "I Have Sent Payment → Enter TXID"}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {step === 4 && selectedTier && (
                <div className="space-y-5" data-testid="quick-checkout-step-4-panel">
                  {paymentMode === "plisio" && plisioInvoice ? (
                    <>
                      <PlisioLiveInvoiceConsole
                        invoice={plisioInvoice}
                        formattedStoreTotal={`${formatMoney(selectedTier.priceMicros, money)} ${money.currency}`}
                        onConfirmed={({ txId: verifiedTx }) => {
                          setPlisioConfirmedTxId(verifiedTx);
                          setSubmittedOrderId(plisioInvoice.orderId);
                        }}
                        testIdPrefix="qc-plisio-invoice"
                      />

                      {/* Order Summary Card */}
                      <div
                        className="space-y-2.5 rounded-2xl border border-border/80 bg-muted/25 p-5 text-xs sm:text-sm"
                        data-testid="qc-verify-order-summary"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-muted-foreground">
                            Order Summary:
                          </span>
                          <span className="font-extrabold text-foreground">
                            {selectedTier.title} {selectedProduct.name}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Payment Protocol:</span>
                          <span className="font-semibold text-muted-foreground">
                            {selectedPlisioCurrency.name} · Plisio (
                            {selectedPlisioCurrency.network})
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border/80 pt-2.5 text-sm font-extrabold sm:text-base">
                          <span className="text-primary">Total Due:</span>
                          <span className="text-primary tabular-nums">
                            {plisioInvoice.cryptoAmount} {plisioInvoice.code} (
                            {formatMoney(selectedTier.priceMicros, money)}{" "}
                            {money.currency})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-start pt-1">
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          data-testid="quick-checkout-back-to-step-3"
                          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-2.5 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                        >
                          <ArrowLeftIcon className="size-4" aria-hidden />
                          <span>Change Coin / Payment Method</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Simple Top Notice Box (no "automated verification" or long text) */}
                      <div
                        className="flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3.5 text-xs font-semibold text-amber-800 dark:text-amber-300 sm:text-sm"
                        data-testid="qc-verify-notice"
                      >
                        <AlertTriangleIcon
                          className="size-4.5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden
                        />
                        <span>
                          {paymentMode === "crypto"
                            ? "Please enter your Transaction ID (TXID) below so the Admin can verify your payment."
                            : "Please review your order summary below and submit your Cash on Delivery order."}
                        </span>
                      </div>

                      {/* Transaction ID Input (Crypto only — no image upload) */}
                      {paymentMode === "crypto" && (
                        <div className="space-y-2">
                          <label
                            htmlFor="qc-verify-txid"
                            className="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
                          >
                            CRYPTO TRANSACTION HASH / TXID * (REQUIRED)
                          </label>
                          <input
                            id="qc-verify-txid"
                            type="text"
                            required
                            value={txId}
                            onChange={(e) => {
                              setTxId(e.target.value);
                              if (verifyError) setVerifyError(null);
                            }}
                            placeholder="e.g. 0x89f4b32a9c118e27a6d8924b1088c4b11f32a79c or TFshfiXsqxNxeTa..."
                            data-testid="qc-verify-txid"
                            className="h-12 w-full rounded-xl border border-border/80 bg-muted/20 px-4 font-mono text-xs text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20 sm:text-sm"
                          />
                        </div>
                      )}

                      {verifyError && (
                        <p
                          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs font-semibold text-destructive"
                          data-testid="qc-verify-error"
                        >
                          {verifyError}
                        </p>
                      )}

                      {/* Order Summary Card */}
                      <div
                        className="space-y-2.5 rounded-2xl border border-border/80 bg-muted/25 p-5 text-xs sm:text-sm"
                        data-testid="qc-verify-order-summary"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-muted-foreground">
                            Order Summary:
                          </span>
                          <span className="font-extrabold text-foreground">
                            {selectedTier.title} {selectedProduct.name}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Payment Protocol:</span>
                          <span className="font-semibold text-muted-foreground">
                            {paymentMode === "crypto" && selectedProtocol
                              ? `${selectedProtocol.name} (${shortNetworkTag(selectedProtocol.network)}) (${selectedProtocol.network})`
                              : "Cash on Delivery (COD)"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border/80 pt-2.5 text-sm font-extrabold sm:text-base">
                          <span className="text-primary">
                            {paymentMode === "crypto" ? "Total Paid:" : "Total Due:"}
                          </span>
                          <span className="text-primary tabular-nums">
                            {formatMoney(selectedTier.priceMicros, money)} {money.currency}
                          </span>
                        </div>
                      </div>

                      {/* Bottom Action Bar: ← Back | Submit Order */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          data-testid="quick-checkout-back-to-step-3"
                          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-2.5 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                        >
                          <ArrowLeftIcon className="size-4" aria-hidden />
                          <span>Back</span>
                        </button>

                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleSubmitOrder()}
                          data-testid="qc-submit-order"
                          className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-emerald-600 px-7 py-3.5 text-sm font-extrabold text-white shadow-lg transition-all hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-60"
                        >
                          <CircleCheckIcon className="size-4.5" aria-hidden />
                          <span>{submitting ? "Submitting Order…" : "Submit Order"}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function QuickCheckoutButton({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [preloadedData, setPreloadedData] = useState<QuickCheckoutPayload | null>(null);

  // When returning from /login?next=...?quickCheckout=<product.id>, automatically open Quick Checkout
  useEffect(() => {
    const url = new URL(window.location.href);
    const queryTarget = url.searchParams.get("quickCheckout");
    let storageTarget: string | null = null;
    try {
      storageTarget = sessionStorage.getItem(PENDING_QC_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }

    const shouldAutoOpen = queryTarget === product.id || storageTarget === product.id;
    if (!shouldAutoOpen) return;

    let cancelled = false;
    const params = new URLSearchParams({ productId: product.id });
    const cid = product.category_id ?? product.category?.id;
    if (cid) params.set("categoryId", cid);

    fetch(`/api/quick-checkout?${params.toString()}`)
      .then(async (res) => {
        if (cancelled) return null;
        if (res.status === 401) {
          return null;
        }
        return res.ok ? ((await res.json()) as QuickCheckoutPayload) : null;
      })
      .then((data) => {
        if (cancelled || !data) return;
        try {
          sessionStorage.removeItem(PENDING_QC_STORAGE_KEY);
        } catch {
          // ignore storage errors
        }
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get("quickCheckout") === product.id) {
          currentUrl.searchParams.delete("quickCheckout");
          window.history.replaceState(
            null,
            "",
            `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
          );
        }
        setPreloadedData(data);
        setOpen(true);
      })
      .catch(() => {
        // ignore network errors
      });

    return () => {
      cancelled = true;
    };
  }, [product.id, product.category_id, product.category?.id]);

  async function handleClick() {
    if (checkingAuth) return;
    setCheckingAuth(true);
    try {
      const params = new URLSearchParams({ productId: product.id });
      const cid = product.category_id ?? product.category?.id;
      if (cid) params.set("categoryId", cid);

      const res = await fetch(`/api/quick-checkout?${params.toString()}`);
      if (res.status === 401) {
        try {
          sessionStorage.setItem(PENDING_QC_STORAGE_KEY, product.id);
        } catch {
          // ignore storage errors
        }
        router.push(buildLoginRedirectUrl(product.id));
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as QuickCheckoutPayload;
        setPreloadedData(data);
      }
      setOpen(true);
    } finally {
      setCheckingAuth(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={checkingAuth}
        onClick={handleClick}
        data-testid="quick-checkout-button"
        className={cn(
          "inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-primary/10 px-4 text-xs font-bold text-primary shadow-2xs transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60",
          className,
        )}
      >
        <ZapIcon className="size-3.5 fill-current" aria-hidden />
        {checkingAuth ? "Checking…" : "Quick Checkout"}
      </button>

      {open && (
        <QuickCheckoutModal
          initialProduct={product}
          initialData={preloadedData}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
