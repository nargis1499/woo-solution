"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckIcon,
  HeadphonesIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
} from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import { MAX_QTY_PER_LINE } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import type { PageBlock } from "@/lib/pages/blocks";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMoney } from "./money-provider";

export type SimpleProductBlockCardProps = {
  block: PageBlock;
  /** Live simple product row when matched by `block.productId`. */
  product?: Product | null;
  /** True inside the Admin Block Editor canvas. */
  editorMode?: boolean;
  /** Storefront stock management flag (`woo_manage_stock`). */
  manageStock?: boolean;
  /** Optional callback in editor mode to focus/open the right-side product selector. */
  onRequestSelectProduct?: () => void;
  className?: string;
};

/**
 * Reusable horizontal "Simple Product" block card for the CMS Block Editor
 * and Storefront pages. Follows the active Light / Dark theme palette tokens
 * (`--card`, `--card-foreground`, `--primary`, `--button`, `--border`, `--muted`).
 */
export function SimpleProductBlockCard({
  block,
  product = null,
  editorMode = false,
  manageStock = true,
  onRequestSelectProduct,
  className,
}: SimpleProductBlockCardProps) {
  const money = useMoney();
  const addItem = useCartStore((s) => s.addItem);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const isSample = !product && !block.productId;
  const productId = product?.id ?? block.productId ?? null;
  const slug = product?.slug ?? block.productSlug ?? "";
  const name = product?.name ?? block.productName ?? "Sony WH-1000XM5 Noise-Canceling";
  const categoryName =
    product?.category?.name ?? block.productCategoryName ?? (isSample ? "AUDIO GEAR" : "FEATURED");
  const categorySlug = product?.category?.slug ?? block.productCategorySlug ?? null;
  const imageUrl = product?.image_url ?? block.productImageUrl ?? null;
  const priceMicros = product?.price_micros ?? block.productPriceMicros ?? 348_000_000;
  const compareAtMicros =
    product !== null
      ? product.compare_at_price_micros
      : (block.productCompareAtMicros ?? (isSample ? 399_990_000 : null));
  const stock = product ? product.stock : (block.productStock ?? 25);
  const description =
    product?.description ??
    block.productDescription ??
    "Industry-leading noise cancellation with 30-hour battery life and ultra-comfortable lightweight design.";

  const imageShape = block.productImageShape ?? "circle";
  const badgeText = (block.productBadgeText?.trim() || categoryName || "FEATURED").toUpperCase();
  const showRating = block.productShowRating !== false;
  const ratingValue = block.productRating?.trim() || "4.9";
  const reviewCount = block.productReviewCount?.trim() ?? "420";
  const showDescription = Boolean(block.productShowDescription);
  const buttonText = (block.productButtonText?.trim() || "ADD TO CART").toUpperCase();

  const onSale = compareAtMicros != null && compareAtMicros > priceMicros;
  const discountPct = onSale
    ? Math.max(1, Math.round(((compareAtMicros - priceMicros) / compareAtMicros) * 100))
    : 0;
  const savingsMicros = onSale ? compareAtMicros - priceMicros : 0;

  const outOfStock = !isSample && manageStock && stock <= 0;
  const maxQty = Math.max(
    1,
    Math.min(!isSample && manageStock && stock > 0 ? stock : MAX_QTY_PER_LINE, MAX_QTY_PER_LINE),
  );

  const handleAddToCart = () => {
    if (outOfStock) return;
    if (!editorMode && productId && slug) {
      addItem(
        {
          productId,
          variationId: null,
          variationLabel: null,
          slug,
          name,
          priceMicros,
          imageUrl,
          stock: manageStock ? stock : null,
        },
        qty,
      );
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div
      data-testid="simple-product-block-card"
      data-product-id={productId ?? "sample"}
      className={cn(
        "group/product-card relative overflow-hidden rounded-2xl border border-border/85 bg-card p-5 text-card-foreground shadow-sm transition-all duration-300 hover:border-primary/40 hover:shadow-md sm:p-6",
        className,
      )}
    >
      {/* Subtle theme-adaptive ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 size-56 rounded-full bg-primary/[0.06] blur-3xl transition-opacity duration-500 group-hover/product-card:opacity-100"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-24 size-56 rounded-full bg-button/[0.05] blur-3xl"
      />

      <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        {/* Left: Product Image Frame + Floating Discount Pill */}
        <div className="relative mx-auto shrink-0 sm:mx-0">
          <div
            className={cn(
              "relative size-28 overflow-hidden border-2 border-primary/25 bg-muted/45 p-1.5 shadow-inner transition-transform duration-300 group-hover/product-card:border-primary/45 sm:size-36",
              imageShape === "circle" ? "rounded-full" : "rounded-2xl",
            )}
          >
            {imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                alt={name}
                loading="lazy"
                className={cn(
                  "size-full object-cover transition-transform duration-500 group-hover/product-card:scale-105",
                  imageShape === "circle" ? "rounded-full" : "rounded-xl",
                )}
              />
            ) : isSample ? (
              <div
                className={cn(
                  "flex size-full flex-col items-center justify-center bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 text-slate-950 shadow-inner dark:from-amber-400 dark:via-yellow-400 dark:to-amber-500",
                  imageShape === "circle" ? "rounded-full" : "rounded-xl",
                )}
              >
                <HeadphonesIcon className="size-12 stroke-[2.1] text-slate-900 drop-shadow-xs sm:size-14" />
              </div>
            ) : (
              <div
                className={cn(
                  "flex size-full items-center justify-center bg-muted text-muted-foreground",
                  imageShape === "circle" ? "rounded-full" : "rounded-xl",
                )}
              >
                <PackageIcon className="size-10 opacity-60" />
              </div>
            )}
          </div>

          {onSale && (
            <span
              data-testid="simple-product-discount-badge"
              className="absolute -top-1 -right-1 z-10 inline-flex items-center rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-extrabold tracking-tight text-white shadow-sm ring-2 ring-card tabular-nums"
            >
              -{discountPct}%
            </span>
          )}

          {outOfStock && (
            <span className="absolute -bottom-1.5 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/95 px-2.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap text-muted-foreground uppercase shadow-xs">
              Sold out
            </span>
          )}
        </div>

        {/* Right: Product Info, Pricing & Action Bar */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Top Metadata Row: Category Badge + Star Rating */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!editorMode && categorySlug ? (
              <Link
                href={`/shop?category=${categorySlug}`}
                data-testid="simple-product-badge"
                className="inline-flex items-center rounded-md border border-primary/25 bg-primary/12 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-primary uppercase transition-colors hover:bg-primary/20"
              >
                {badgeText}
              </Link>
            ) : (
              <span
                data-testid="simple-product-badge"
                className="inline-flex items-center rounded-md border border-primary/25 bg-primary/12 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-primary uppercase"
              >
                {badgeText}
              </span>
            )}

            {showRating && (
              <div
                data-testid="simple-product-rating"
                className="inline-flex items-center gap-1 text-xs font-semibold"
              >
                <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                <span className="font-bold text-foreground tabular-nums">{ratingValue}</span>
                {reviewCount && (
                  <span className="text-muted-foreground tabular-nums">({reviewCount})</span>
                )}
              </div>
            )}
          </div>

          {/* Product Title & Optional Description */}
          <div className="space-y-1">
            <h3
              data-testid="simple-product-title"
              className="text-lg font-bold tracking-tight text-foreground leading-snug sm:text-lg lg:text-xl"
            >
              {!editorMode && slug ? (
                <Link
                  href={`/products/${slug}`}
                  className="transition-colors hover:text-primary"
                >
                  {name}
                </Link>
              ) : (
                name
              )}
            </h3>

            {showDescription && description && (
              <p
                data-testid="simple-product-description"
                className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm"
              >
                {description}
              </p>
            )}
          </div>

          {/* Price, Compare-at Price & Savings Pill */}
          <div className="flex flex-wrap items-baseline gap-3 pt-0.5">
            <span
              data-testid="simple-product-price"
              className="text-2xl font-extrabold tracking-tight text-primary tabular-nums sm:text-3xl"
            >
              {formatMoney(priceMicros, money)}
            </span>

            {onSale && compareAtMicros != null && (
              <>
                <span
                  data-testid="simple-product-compare-price"
                  className="text-sm font-medium text-muted-foreground line-through tabular-nums sm:text-base"
                >
                  {formatMoney(compareAtMicros, money)}
                </span>
                <span
                  data-testid="simple-product-save-badge"
                  className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums"
                >
                  Save {formatMoney(savingsMicros, money)}
                </span>
              </>
            )}
          </div>

          {/* Horizontal Divider + Bottom Action Controls */}
          <div className="border-t border-border/70 pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Quantity Stepper (- 1 +) */}
              <div
                role="group"
                aria-label="Quantity"
                className="inline-flex h-10 items-center rounded-xl border border-border bg-background/85 p-1 shadow-2xs dark:bg-muted/35"
              >
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  data-testid="simple-product-qty-minus"
                  disabled={qty <= 1 || outOfStock}
                  onClick={(e) => {
                    e.stopPropagation();
                    setQty((prev) => Math.max(1, prev - 1));
                  }}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <MinusIcon className="size-3.5" />
                </button>
                <span
                  data-testid="simple-product-qty-value"
                  className="min-w-9 px-2 text-center text-sm font-bold text-foreground tabular-nums select-none"
                >
                  {qty}
                </span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  data-testid="simple-product-qty-plus"
                  disabled={qty >= maxQty || outOfStock}
                  onClick={(e) => {
                    e.stopPropagation();
                    setQty((prev) => Math.min(maxQty, prev + 1));
                  }}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              {/* Add to Cart Button */}
              <button
                type="button"
                disabled={outOfStock}
                data-testid="simple-product-add-to-cart"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddToCart();
                }}
                aria-live="polite"
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-xs font-bold tracking-wider uppercase shadow-sm transition-all sm:px-6 sm:text-sm",
                  outOfStock
                    ? "cursor-not-allowed border border-border bg-muted text-muted-foreground opacity-60"
                    : "bg-primary text-primary-foreground hover:opacity-92 active:scale-[0.99]",
                )}
              >
                {outOfStock ? (
                  <span>OUT OF STOCK</span>
                ) : added ? (
                  <>
                    <CheckIcon className="size-4" />
                    <span>ADDED TO CART</span>
                  </>
                ) : (
                  <>
                    <ShoppingCartIcon className="size-4" />
                    <span>{buttonText}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
