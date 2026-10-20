"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AwardIcon,
  CheckIcon,
  ChevronDownIcon,
  FlameIcon,
  GlobeIcon,
  LockIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { parseProductFeatures } from "@/lib/home-sections";
import { formatMoney } from "@/lib/money";
import { resolveQuickCheckoutTiers, type QuickCheckoutTier } from "@/lib/quick-checkout";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";

const PENDING_QC_STORAGE_KEY = "woo_pending_quick_checkout";

type QuickCheckoutCustomer = {
  fullName: string;
  email: string;
  phone?: string;
};

type QuickCheckoutPayload = {
  authenticated?: boolean;
  storeName?: string;
  customer?: QuickCheckoutCustomer;
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

  // Step navigation & step gating: customer cannot advance to Step 2 until Step 1 is passed
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

  useEffect(() => {
    if (
      initialData?.products &&
      initialData.products.length > 0 &&
      initialData.customer
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
                Automated verification &amp; instant recovery file delivery
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
              const active = step === s.num;
              const completed = step > s.num;
              const canNavigate = s.num <= maxUnlockedStep;
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
                            <span className="truncate">{productSubtitleText(item, idx)}</span>
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
                      Estimated Unit Cost: {formatMoney(selectedTier.unitPriceMicros, money)}/unit
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
                  Your contact details are strictly used for instant recovery spreadsheet
                  delivery and order notifications.
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

          {step >= 3 && (
            <div className="space-y-5" data-testid="quick-checkout-step-3-panel">
              <div className="rounded-2xl border border-border/80 bg-muted/25 p-5 text-sm">
                <p className="font-bold text-foreground">
                  Step 3: Payment Method Selection
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Delivering to <span className="font-semibold text-foreground">{fullName}</span> ({email})
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-card px-5 py-2.5 text-xs font-bold text-foreground shadow-2xs transition-colors hover:bg-muted/50 sm:text-sm"
                >
                  <ArrowLeftIcon className="size-4" aria-hidden />
                  <span>Back</span>
                </button>
              </div>
            </div>
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
