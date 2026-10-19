import Link from "next/link";
import { ShoppingBagIcon, ZapIcon } from "lucide-react";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AddToCartButton } from "./add-to-cart-button";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { WishlistButton } from "./wishlist-button";

export function ProductCard({
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

  return (
    <Card
      data-testid="product-card"
      className="group flex flex-col gap-0 overflow-hidden rounded-2xl border-border/80 bg-card py-0 shadow-xs transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-md"
    >
      <Link
        href={`/products/${product.slug}`}
        className="relative block overflow-hidden"
        aria-label={product.name}
      >
        <ProductImage
          src={product.image_url}
          alt={product.name}
          priority={priority}
          className="aspect-[4/3] transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {product.brand && (
          <span
            data-testid="product-card-brand"
            className="absolute top-3 left-3 z-10 rounded-full bg-zinc-900/85 px-3 py-1 text-[11px] font-bold tracking-wider text-white uppercase shadow-xs backdrop-blur-xs"
          >
            {product.brand}
          </span>
        )}
        {soldOut ? (
          <Badge variant="secondary" className="absolute top-3 right-3 z-10 rounded-full">
            Sold out
          </Badge>
        ) : (
          discountPct > 0 && (
            <span
              data-testid="product-card-discount"
              className="absolute top-3 right-3 z-10 rounded-full bg-(--button) bg-[image:var(--button-image)] px-2.5 py-1 text-[11px] font-bold text-(--button-foreground) shadow-xs tabular-nums"
            >
              -{discountPct}%
            </span>
          )
        )}
      </Link>

      <CardContent className="flex flex-1 flex-col p-5">
        {(product.category || isQuickCheckout) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {product.category ? (
              <Link
                href={`/shop?category=${product.category.slug}`}
                className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-primary uppercase transition-colors hover:bg-primary/15"
              >
                {product.category.name}
              </Link>
            ) : (
              <span />
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

        <h3 className="line-clamp-1 text-base leading-snug font-bold tracking-tight text-foreground">
          <Link
            href={`/products/${product.slug}`}
            className="transition-colors hover:text-primary"
          >
            {product.name}
          </Link>
        </h3>

        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {product.description}
          </p>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-2">
            <Price
              micros={product.price_micros}
              regularMicros={product.compare_at_price_micros}
              from={product.type === "variable"}
              className="text-lg font-extrabold tracking-tight"
            />

            <div className="flex shrink-0 items-center gap-2">
              <WishlistButton product={product} />
              {product.type === "variable" ? (
                <LinkButton
                  href={`/products/${product.slug}`}
                  size="sm"
                  className="h-9 rounded-xl !bg-primary px-4 text-xs font-semibold !text-primary-foreground shadow-xs hover:!bg-primary/90 ![background-image:none]"
                >
                  <ShoppingBagIcon className="size-3.5" /> Add
                </LinkButton>
              ) : (
                <AddToCartButton
                  product={product}
                  size="sm"
                  label="Add"
                  icon="bag"
                  manageStock={manageStock}
                  className="h-9 rounded-xl !bg-primary px-4 text-xs font-semibold !text-primary-foreground shadow-xs hover:!bg-primary/90 ![background-image:none]"
                />
              )}
            </div>
          </div>

          {isQuickCheckout && !soldOut && (
            <button
              type="button"
              data-testid="quick-checkout-button"
              className="mt-2.5 inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-primary/10 px-4 text-xs font-bold text-primary shadow-2xs transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <ZapIcon className="size-3.5 fill-current" aria-hidden />
              Quick Checkout
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
