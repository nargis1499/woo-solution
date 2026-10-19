"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightIcon,
  AwardIcon,
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

const STEPS = [
  { num: 1, label: "1. Package" },
  { num: 2, label: "2. Contact" },
  { num: 3, label: "3. Payment" },
  { num: 4, label: "4. Verify" },
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

export function QuickCheckoutModal({
  initialProduct,
  onClose,
}: {
  initialProduct: Product;
  onClose: () => void;
}) {
  const money = useMoney();
  const [storeName, setStoreName] = useState<string>("Woo Solution");
  const [products, setProducts] = useState<Product[]>([initialProduct]);
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProduct.id);
  const [selectedTierByProduct, setSelectedTierByProduct] = useState<Record<string, string>>({});
  const [step, setStep] = useState<number>(1);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ productId: initialProduct.id });
    const cid = initialProduct.category_id ?? initialProduct.category?.id;
    if (cid) params.set("categoryId", cid);

    fetch(`/api/quick-checkout?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { storeName?: string; products?: Product[] } | null) => {
        if (cancelled || !data) return;
        if (data.storeName) setStoreName(data.storeName);
        if (Array.isArray(data.products) && data.products.length > 0) {
          setProducts(data.products);
        }
      })
      .catch(() => {
        // Keep initialProduct fallback if network fails
      });

    return () => {
      cancelled = true;
    };
  }, [initialProduct.id, initialProduct.category_id, initialProduct.category?.id]);

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

  // Default to the 2nd tier (e.g. 2x or 5x) when multiple tiers exist, or the stored selection
  const preferredDefaultTier =
    tiers.find((t) => t.quantity === 5) ?? tiers[Math.min(1, tiers.length - 1)] ?? tiers[0];
  const activeTierId = selectedTierByProduct[selectedProduct.id] ?? preferredDefaultTier?.id;
  const selectedTier = tiers.find((t) => t.id === activeTierId) ?? preferredDefaultTier ?? tiers[0];

  const categoryTitle = selectedProduct.category?.name
    ? `SELECT ${selectedProduct.category.name.toUpperCase()} PRODUCT`
    : "SELECT VERIFIED PRODUCT";

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
                Automated verification &amp; instant order processing
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
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => {
                    if (s.num <= step) setStep(s.num);
                  }}
                  data-testid={`quick-checkout-step-${s.num}`}
                  className="flex items-center gap-2 text-xs font-bold transition-colors sm:text-sm"
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold transition-all",
                      active || completed
                        ? "bg-(--button) bg-[image:var(--button-image)] text-(--button-foreground) shadow-xs"
                        : "bg-muted-foreground/20 text-muted-foreground",
                    )}
                  >
                    {s.num}
                  </span>
                  <span
                    className={cn(
                      active ? "text-primary" : "text-muted-foreground",
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
              onClick={() => setStep(2)}
              data-testid="quick-checkout-continue"
              className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-(--button) bg-[image:var(--button-image)] px-7 py-3.5 text-sm font-extrabold text-(--button-foreground) shadow-lg transition-all hover:opacity-95 active:scale-[0.99]"
            >
              <span>Continue to Contact Details</span>
              <ArrowRightIcon className="size-4" aria-hidden />
            </button>
          </div>
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
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="quick-checkout-button"
        className={cn(
          "inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-primary/10 px-4 text-xs font-bold text-primary shadow-2xs transition-colors hover:bg-primary hover:text-primary-foreground",
          className,
        )}
      >
        <ZapIcon className="size-3.5 fill-current" aria-hidden />
        Quick Checkout
      </button>

      {open && (
        <QuickCheckoutModal
          initialProduct={product}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
