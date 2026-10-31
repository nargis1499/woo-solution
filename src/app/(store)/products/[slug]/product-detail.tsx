"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BanknoteIcon,
  BatteryFullIcon,
  CpuIcon,
  MonitorIcon,
  PackageCheckIcon,
  ShieldCheckIcon,
  TruckIcon,
} from "lucide-react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductGallery } from "@/components/product-gallery";
import { Price } from "@/components/price";
import { QuantityInput } from "@/components/quantity-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { findVariation, priceRange, type DraftAttribute } from "@/lib/variations";
import { FREE_SHIPPING_THRESHOLD_MICROS } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { mediaPreviewUrl, slidesFor } from "@/lib/media/shared";
import { parseProductFeatures } from "@/lib/home-sections";
import { useMoney } from "@/components/money-provider";
import type { Product } from "@/lib/types";

const COLOR_SWATCHES: [string, string][] = [
  ["black", "#111827"], ["space black", "#151722"], ["midnight", "#151722"],
  ["silver", "#cbd5e1"], ["white", "#f8fafc"], ["starlight", "#e7dfcf"],
  ["gray", "#64748b"], ["grey", "#64748b"], ["blue", "#2563eb"],
  ["navy", "#172554"], ["red", "#dc2626"], ["green", "#059669"],
  ["purple", "#7e22ce"], ["violet", "#7c3aed"], ["pink", "#db2777"],
  ["gold", "#eab308"], ["orange", "#ea580c"], ["brown", "#854d0e"],
];

function swatchFor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return COLOR_SWATCHES.find(([name]) => normalized === name || normalized.includes(name))?.[1] ?? null;
}

/** The product gallery, option pickers and purchase actions share selected variation state. */
export function ProductShowcase({
  product,
  manageStock: globalManageStock,
  shippingEnabled,
  shippingRateMicros,
}: {
  product: Product;
  manageStock: boolean;
  shippingEnabled: boolean;
  shippingRateMicros: number;
}) {
  const manageStock = product.manage_stock ?? globalManageStock;
  const money = useMoney();
  const attributes = product.attributes ?? [];
  const variations = useMemo(() => (product.variations ?? []).filter((v) => v.is_active), [product.variations]);
  const isVariable = (product.type ?? "simple") === "variable" && attributes.length > 0;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const complete = isVariable && attributes.every((attribute) => Boolean(selection[attribute.name]));
  // A partial attribute pick may match several rows; only use a variation once every axis is selected.
  const selected = complete ? findVariation(variations, selection) : null;
  const range = priceRange(variations);

  function available(attribute: DraftAttribute, value: string): boolean {
    return variations.some((variation) =>
      variation.combination[attribute.name]?.toLowerCase() === value.toLowerCase() &&
      (!manageStock || variation.stock > 0) &&
      attributes.every((other) => other.name === attribute.name || !selection[other.name] || variation.combination[other.name] === selection[other.name]),
    );
  }

  function optionPrice(attribute: DraftAttribute, value: string): number | null {
    const variation = variations.find((item) => item.combination[attribute.name]?.toLowerCase() === value.toLowerCase() &&
      attributes.every((other) => other.name === attribute.name || !selection[other.name] || item.combination[other.name] === selection[other.name]));
    if (!variation) return null;
    const base = range?.min ?? product.price_micros;
    return variation.price_micros > base ? variation.price_micros - base : null;
  }

  const stock = selected ? selected.stock : product.stock;
  const inStock = isVariable
    ? variations.length > 0 && (!manageStock || (selected ? selected.stock > 0 : variations.some((variation) => variation.stock > 0)))
    : !manageStock || stock > 0;
  const priceMicros = selected?.price_micros ?? (isVariable ? range?.min ?? product.price_micros : product.price_micros);
  const regularMicros = selected?.compare_at_price_micros ?? (isVariable ? null : product.compare_at_price_micros);
  const canBuy = !isVariable || Boolean(selected);
  const gallerySlides = useMemo(() => {
    const slides = slidesFor(product);
    const variationImage = selected?.image_media
      ? mediaPreviewUrl(selected.image_media, "large") ?? selected.image_url
      : selected?.image_url;
    const variationThumb = selected?.image_media
      ? mediaPreviewUrl(selected.image_media, "thumbnail") ?? selected.image_url
      : selected?.image_url;
    if (!variationImage) return slides;
    return [{ src: variationImage, thumb: variationThumb ?? variationImage, alt: selected?.image_media?.alt || `${product.name} ${selected?.label ?? ""}`.trim() }, ...slides.slice(1)];
  }, [product, selected]);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 xl:gap-12" data-testid="product-showcase">
      <ProductGallery slides={gallerySlides} product={product} />

      <section className="min-w-0 space-y-5" aria-labelledby="product-title">
        <div className="flex flex-wrap items-center gap-2">
          {product.brand && <Badge className="border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-[11px] font-bold tracking-widest text-indigo-200 uppercase">{product.brand}</Badge>}
          {product.category && (
            <Link href={`/shop?category=${encodeURIComponent(product.category.slug)}`}>
              <Badge className="border border-slate-600 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-200 uppercase transition-colors hover:border-indigo-400/60 hover:text-white">
                {product.category.name}
              </Badge>
            </Link>
          )}
          <Badge className={inStock ? "border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300" : "border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-300"}>
            <span className={inStock ? "mr-1.5 size-1.5 rounded-full bg-emerald-400" : "mr-1.5 size-1.5 rounded-full bg-rose-400"} />
            {inStock ? "In stock" : "Out of stock"}
          </Badge>
        </div>

        <div>
          <h1 id="product-title" className="text-3xl font-bold tracking-tight text-white sm:text-4xl xl:text-[2.7rem]">{product.name}</h1>
          {product.description && <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{product.description}</p>}
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/75 px-4 py-4 shadow-sm sm:px-5" data-testid="product-price-panel">
          <div className="flex flex-wrap items-center gap-3">
            <Price micros={priceMicros} regularMicros={regularMicros} from={isVariable && !selected} className="text-3xl sm:text-4xl [&>span:first-child]:text-white [&>span:first-child]:font-extrabold" />
            {regularMicros != null && regularMicros > priceMicros && <Badge className="border border-indigo-400/30 bg-indigo-500/15 text-indigo-200">Save {formatMoney(regularMicros - priceMicros, money)}</Badge>}
            {isVariable && !selected && range && range.min !== range.max && <span className="text-xs text-slate-400">Options change the final price</span>}
          </div>
        </div>

        {isVariable && (
          <div className="space-y-5" data-testid="variation-picker">
            {attributes.map((attribute) => {
              const isColor = /colou?r|shade|finish/i.test(attribute.name) && attribute.options.every((option) => Boolean(swatchFor(option)));
              return (
                <fieldset key={attribute.id} className="space-y-2.5">
                  <legend className="text-xs font-bold tracking-[0.13em] text-slate-300 uppercase">
                    {attribute.name}{selection[attribute.name] && <span className="ml-1.5 font-medium text-indigo-300">· {selection[attribute.name]}</span>}
                  </legend>
                  {isColor ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {attribute.options.map((option) => {
                        const active = selection[attribute.name] === option;
                        const disabled = !available(attribute, option);
                        return <button key={option} type="button" title={option} aria-label={`${attribute.name}: ${option}`} aria-pressed={active} disabled={disabled} onClick={() => { setSelection((prev) => ({ ...prev, [attribute.name]: option })); setQuantity(1); }} className={`size-9 rounded-full border-2 transition ${active ? "border-indigo-400 ring-2 ring-indigo-500/35 ring-offset-2 ring-offset-slate-950" : "border-slate-500/50 hover:border-indigo-300"} ${disabled ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`} style={{ backgroundColor: swatchFor(option) ?? "#64748b" }}><span className="sr-only">{option}</span></button>;
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {attribute.options.map((option) => {
                        const active = selection[attribute.name] === option;
                        const disabled = !available(attribute, option);
                        const extra = optionPrice(attribute, option);
                        return <button key={option} type="button" aria-pressed={active} disabled={disabled} onClick={() => { setSelection((prev) => ({ ...prev, [attribute.name]: option })); setQuantity(1); }} className={`min-h-10 rounded-lg border px-4 py-2 text-sm font-semibold transition ${active ? "border-indigo-400 bg-indigo-600 text-white shadow-sm" : "border-slate-700 bg-slate-900 text-slate-200 hover:border-indigo-400/70 hover:bg-slate-800"} ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
                          {option}{extra != null && <span className="ml-1.5 text-xs opacity-80">(+{formatMoney(extra, money)})</span>}
                        </button>;
                      })}
                    </div>
                  )}
                </fieldset>
              );
            })}
            {complete && !selected && <p className="text-sm text-rose-300">That combination isn’t available. Choose another option.</p>}
          </div>
        )}

        <div className="space-y-3 pt-1">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {inStock && canBuy && <QuantityInput value={quantity} onChange={setQuantity} max={manageStock ? stock : undefined} label="Product quantity" />}
            {canBuy ? (
              <AddToCartButton product={product} variation={selected} quantity={quantity} size="lg" manageStock={manageStock} className="h-12 flex-1 border border-slate-700 bg-slate-800 text-white hover:bg-slate-700" />
            ) : (
              <Button size="lg" isDisabled className="h-12 flex-1 bg-slate-800 text-slate-400">Choose options</Button>
            )}
          </div>
          {inStock && canBuy && <AddToCartButton product={product} variation={selected} quantity={quantity} size="lg" mode="buy" label="Buy Now — Fast Checkout" manageStock={manageStock} className="h-[3.25rem] w-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-950/40 hover:from-indigo-400 hover:to-violet-500" />}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-800 pt-4 text-xs text-slate-300 sm:text-sm">
          {shippingEnabled && <div className="flex items-center gap-2"><TruckIcon className="size-4 shrink-0 text-indigo-300" />{shippingRateMicros === 0 ? "Free shipping" : `Shipping from ${formatMoney(shippingRateMicros, money)} · free over ${formatMoney(FREE_SHIPPING_THRESHOLD_MICROS, money)}`}</div>}
          <div className="flex items-center gap-2"><BanknoteIcon className="size-4 shrink-0 text-indigo-300" />Cash on delivery available</div>
          <div className="flex items-center gap-2"><ShieldCheckIcon className="size-4 shrink-0 text-indigo-300" />Secure checkout</div>
          {(selected?.sku || product.sku || !isVariable) && <div className="flex min-w-0 items-center gap-2"><PackageCheckIcon className="size-4 shrink-0 text-indigo-300" /><span className="truncate">SKU: {selected?.sku ?? product.sku ?? product.id.slice(0, 8).toUpperCase()}</span></div>}
        </div>
      </section>
    </div>
  );
}

/** Product details below the buy panel; only information stored on the product is shown. */
export function ProductInformationTabs({ product }: { product: Product }) {
  const [tab, setTab] = useState("features");
  const features = parseProductFeatures(product.features, 3);
  const specs: { label: string; value: string; href?: string }[] = [
    ...(product.brand ? [{ label: "Brand", value: product.brand }] : []),
    ...(product.category
      ? [
          {
            label: "Category",
            value: product.category.name,
            href: `/shop?category=${encodeURIComponent(product.category.slug)}`,
          },
        ]
      : []),
    ...(product.sku ? [{ label: "SKU", value: product.sku }] : []),
    ...((product.attributes ?? []).map((attribute) => ({
      label: attribute.name,
      value: attribute.options.join(", "),
    }))),
  ];

  return (
    <section className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-sm sm:mt-16 sm:p-8" aria-label="Product information" data-testid="product-information">
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))} className="w-full flex-col">
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start gap-2 rounded-none border-b border-slate-800 p-0 text-slate-400 group-data-horizontal/tabs:h-auto"
        >
          <TabsTrigger
            id="features"
            className="-mb-px h-11 flex-none cursor-pointer rounded-none px-3 text-sm text-slate-400 hover:text-slate-100 data-selected:text-indigo-300 dark:text-slate-400 dark:hover:text-slate-100 dark:data-selected:text-indigo-300 after:bg-indigo-400 group-data-horizontal/tabs:after:bottom-0 sm:px-5"
          >
            Key Features
          </TabsTrigger>
          <TabsTrigger
            id="specifications"
            className="-mb-px h-11 flex-none cursor-pointer rounded-none px-3 text-sm text-slate-400 hover:text-slate-100 data-selected:text-indigo-300 dark:text-slate-400 dark:hover:text-slate-100 dark:data-selected:text-indigo-300 after:bg-indigo-400 group-data-horizontal/tabs:after:bottom-0 sm:px-5"
          >
            Specifications
          </TabsTrigger>
          <TabsTrigger
            id="delivery"
            className="-mb-px h-11 flex-none cursor-pointer rounded-none px-3 text-sm text-slate-400 hover:text-slate-100 data-selected:text-indigo-300 dark:text-slate-400 dark:hover:text-slate-100 dark:data-selected:text-indigo-300 after:bg-indigo-400 group-data-horizontal/tabs:after:bottom-0 sm:px-5"
          >
            Delivery &amp; Payment
          </TabsTrigger>
        </TabsList>
        {/* shouldForceMount keeps every tab panel in the SSR HTML DOM so Googlebot crawls
            Key Features, Specifications and Delivery & Payment without needing JS clicks. */}
        <TabsContent id="features" shouldForceMount className="pt-6 data-inert:hidden">
          <h2 className="sr-only">Key Features</h2>
          {features.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = [CpuIcon, BatteryFullIcon, MonitorIcon][index % 3];
                return (
                  <article key={`${feature}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                    <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-semibold leading-6 text-white">{feature}</h3>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
              Product highlights will appear here when added to the catalog.
            </p>
          )}
        </TabsContent>
        <TabsContent id="specifications" shouldForceMount className="pt-6 data-inert:hidden">
          <h2 className="sr-only">Specifications</h2>
          {specs.length ? (
            <dl className="grid overflow-hidden rounded-xl border border-slate-800 sm:grid-cols-2">
              {specs.map(({ label, value, href }, index) => (
                <div
                  key={label}
                  className={`grid grid-cols-[minmax(8rem,0.7fr)_1fr] gap-4 border-slate-800 px-4 py-3 text-sm ${index > 0 ? "border-t" : ""} sm:even:border-l sm:even:pl-5`}
                >
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="font-medium text-slate-100">
                    {href ? (
                      <Link href={href} className="underline-offset-4 hover:text-indigo-300 hover:underline">
                        {value}
                      </Link>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
              No extra specifications have been provided for this product.
            </p>
          )}
        </TabsContent>
        <TabsContent id="delivery" shouldForceMount className="pt-6 data-inert:hidden">
          <h2 className="sr-only">Delivery &amp; Payment</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-5">
              <TruckIcon className="mt-0.5 size-5 shrink-0 text-indigo-300" aria-hidden />
              <div>
                <h3 className="font-semibold text-white">Shipping</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Shipping options and any applicable charges are shown during checkout.
                </p>
              </div>
            </article>
            <article className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-5">
              <BanknoteIcon className="mt-0.5 size-5 shrink-0 text-indigo-300" aria-hidden />
              <div>
                <h3 className="font-semibold text-white">Payment</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Cash on delivery and configured online payment methods are available at checkout.
                </p>
              </div>
            </article>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
