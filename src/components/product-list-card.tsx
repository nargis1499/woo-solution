import Link from "next/link";
import { CheckIcon, ShoppingBagIcon, ZapIcon } from "lucide-react";
import { parseProductFeatures } from "@/lib/home-sections";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AddToCartButton } from "./add-to-cart-button";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { WishlistButton } from "./wishlist-button";

export function ProductListCard({
  product,
  priority,
  manageStock = true,
  quickCheckout,
}: {
  product: Product;
  priority?: boolean;
  manageStock?: boolean;
  quickCheckout?: boolean;
}) {
  const isQuickCheckout = quickCheckout ?? Boolean(product.quick_checkout);
  const onSale =
    product.compare_at_price_micros != null &&
    product.compare_at_price_micros > product.price_micros;
  const discountPct = onSale
    ? Math.max(
        1,
        Math.round(
          (((product.compare_at_price_micros as number) - product.price_micros) /
            (product.compare_at_price_micros as number)) *
            100,
        ),
      )
    : 0;
  const soldOut = manageStock && product.stock <= 0;
  const features = parseProductFeatures(product.features, 3);

  return (
    <Card
      data-testid="product-list-card"
      className="group flex flex-col gap-4 overflow-hidden rounded-2xl border-border/80 bg-card p-4 shadow-xs transition-[box-shadow,border-color,transform] duration-200 hover:border-primary/40 hover:shadow-md sm:flex-row sm:items-center sm:gap-5 sm:p-4"
    >
      {/* Left Thumbnail Image */}
      <Link
        href={`/products/${product.slug}`}
        className="relative block w-full shrink-0 overflow-hidden rounded-xl sm:w-52"
        aria-label={product.name}
      >
        <ProductImage
          src={product.image_url}
          alt={product.name}
          priority={priority}
          sizes="(min-width: 640px) 208px, 100vw"
          className="aspect-[16/10] rounded-xl transition-transform duration-500 group-hover:scale-[1.03] sm:aspect-[4/3]"
        />
        {product.brand && (
          <span
            data-testid="product-card-brand"
            className="absolute top-2.5 left-2.5 z-10 rounded-full bg-zinc-900/85 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase shadow-xs backdrop-blur-xs"
          >
            {product.brand}
          </span>
        )}
        {soldOut ? (
          <Badge variant="secondary" className="absolute top-2.5 right-2.5 z-10 rounded-full text-[10px]">
            Sold out
          </Badge>
        ) : (
          discountPct > 0 && (
            <span
              data-testid="product-card-discount"
              className="absolute top-2.5 right-2.5 z-10 rounded-full bg-(--button) bg-[image:var(--button-image)] px-2 py-0.5 text-[10px] font-bold text-(--button-foreground) shadow-xs tabular-nums"
            >
              -{discountPct}%
            </span>
          )
        )}
      </Link>

      {/* Middle Product Details & Max 3 Feature Pills */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {(product.category || isQuickCheckout) && (
          <div className="flex items-center gap-2">
            {product.category && (
              <Link
                href={`/shop?category=${product.category.slug}`}
                className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-primary uppercase transition-colors hover:bg-primary/15"
              >
                {product.category.name}
              </Link>
            )}
            {isQuickCheckout && (
              <span
                data-testid="product-card-quick-checkout-icon"
                title="Quick Checkout enabled"
                className="inline-flex items-center gap-1 rounded-md bg-primary/12 px-2 py-0.5 text-[11px] font-bold text-primary"
              >
                <ZapIcon className="size-3 fill-current" aria-hidden />
              </span>
            )}
          </div>
        )}

        <h3 className="line-clamp-1 text-lg leading-snug font-extrabold tracking-tight text-foreground">
          <Link
            href={`/products/${product.slug}`}
            className="transition-colors hover:text-primary"
          >
            {product.name}
          </Link>
        </h3>

        {product.description && (
          <p className="line-clamp-1 text-sm text-muted-foreground">{product.description}</p>
        )}

        {features.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 pt-1.5"
            data-testid="product-list-features"
          >
            {features.map((feat, idx) => (
              <span
                key={idx}
                data-testid="product-list-feature"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/45 px-2.5 py-1 text-xs font-medium text-foreground/85"
              >
                <CheckIcon
                  className="size-3.5 shrink-0 text-primary"
                  strokeWidth={2.5}
                  aria-hidden
                />
                {feat}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right Price, Free Delivery & Actions */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-border/60 pt-3 sm:items-end sm:justify-center sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
        <div className="flex w-full items-center justify-between gap-4 sm:flex-col sm:items-end">
          <div className="text-left sm:text-right">
            <Price
              micros={product.price_micros}
              regularMicros={product.compare_at_price_micros}
              from={product.type === "variable"}
              className="text-xl font-extrabold tracking-tight sm:text-2xl"
            />
            <span className="mt-0.5 block text-xs font-semibold text-primary">
              Free Delivery
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <WishlistButton product={product} className="size-10 rounded-xl" />
            {product.type === "variable" ? (
              <LinkButton
                href={`/products/${product.slug}`}
                size="default"
                className="h-10 rounded-xl !bg-primary px-5 text-xs font-semibold !text-primary-foreground shadow-xs hover:!bg-primary/90 ![background-image:none]"
              >
                <ShoppingBagIcon className="size-4" /> Add to Cart
              </LinkButton>
            ) : (
              <AddToCartButton
                product={product}
                size="default"
                label="Add to Cart"
                icon="bag"
                manageStock={manageStock}
                className="h-10 rounded-xl !bg-primary px-5 text-xs font-semibold !text-primary-foreground shadow-xs hover:!bg-primary/90 ![background-image:none]"
              />
            )}
          </div>
        </div>

        {isQuickCheckout && !soldOut && (
          <button
            type="button"
            data-testid="quick-checkout-button"
            className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-primary/10 px-4 text-xs font-bold text-primary shadow-2xs transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <ZapIcon className="size-3.5 fill-current" aria-hidden />
            Quick Checkout
          </button>
        )}
      </div>
    </Card>
  );
}
