"use client";

import { useMemo, useState } from "react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { QuantityInput } from "@/components/quantity-input";
import { Price } from "@/components/price";
import { useMoney } from "@/components/money-provider";
import { findVariation, priceRange, type DraftAttribute } from "@/lib/variations";
import { formatMoney } from "@/lib/money";
import type { Product, ProductVariation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Client island on the product page: quantity picker, add-to-cart / buy-now buttons and –
 * for a variable product – one dropdown per attribute. Picking a value for every attribute
 * selects the matching variation, and its own price, stock and image take over.
 */
export function ProductPurchasePanel({ product, manageStock }: { product: Product; manageStock: boolean }) {
  const money = useMoney();
  const attributes = product.attributes ?? [];
  const variations = useMemo(() => (product.variations ?? []).filter((v) => v.is_active), [product.variations]);
  const isVariable = (product.type ?? "simple") === "variable" && attributes.length > 0;

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);

  const selected = isVariable ? findVariation(variations, selection) : null;
  const complete = attributes.length > 0 && attributes.every((a) => selection[a.name]);
  const range = priceRange(variations);

  // Which values still lead to a buyable combination, given the other picks.
  const combinations = useMemo(() => {
    const map = new Map<string, ProductVariation[]>();
    for (const v of variations) {
      const key = JSON.stringify(v.combination);
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return [...map.values()].flat();
  }, [variations]);

  function available(attribute: DraftAttribute, value: string): boolean {
    return combinations.some((v) =>
      v.combination[attribute.name]?.toLowerCase() === value.toLowerCase() &&
      attributes.every((a) => a.name === attribute.name || !selection[a.name] || v.combination[a.name] === selection[a.name]),
    );
  }

  const stock = selected ? selected.stock : product.stock;
  const inStock = !manageStock || stock > 0;
  const priceMicros = selected ? selected.price_micros : product.price_micros;
  const regularMicros = selected ? selected.compare_at_price_micros : product.compare_at_price_micros;
  const buyable = isVariable ? Boolean(selected) : true;
  const image = selected?.image_url ?? null;

  return (
    <div className="space-y-4">
      {isVariable && (
        <div className="space-y-3" data-testid="variation-picker">
          {attributes.map((attribute) => (
            <Field key={attribute.id} data-invalid={complete && !selected ? true : undefined}>
              <FieldLabel htmlFor={`attribute-${attribute.id}`}>{attribute.name}</FieldLabel>
              <Select
                aria-label={attribute.name}
                placeholder={`Choose ${attribute.name.toLowerCase()}`}
                selectedKey={selection[attribute.name] ?? null}
                onSelectionChange={(key) => {
                  if (key === null) return;
                  setSelection((prev) => ({ ...prev, [attribute.name]: String(key) }));
                  setQty(1);
                }}
              >
                <SelectTrigger id={`attribute-${attribute.id}`} className="w-full sm:max-w-xs" data-testid={`attribute-select-${attribute.name.toLowerCase()}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {attribute.options.map((option) => (
                    <SelectItem key={option} id={option} isDisabled={!available(attribute, option)}>
                      {option}
                      {!available(attribute, option) && " — unavailable"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
          {complete && !selected && <FieldError>That combination is not available – try another one.</FieldError>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* selected variation price takes over from the product range shown above */}
        {isVariable && (
          <span className="text-xl" data-testid="selected-price">
            {selected ? (
              <Price micros={priceMicros} regularMicros={regularMicros} />
            ) : range ? (
              <span className="text-base text-muted-foreground">
                {range.min === range.max
                  ? formatMoney(range.min, money)
                  : `${formatMoney(range.min, money)} – ${formatMoney(range.max, money)}`}
              </span>
            ) : null}
          </span>
        )}
        {manageStock && (
          <Badge
            variant={inStock ? "outline" : "destructive"}
            data-testid="stock-badge"
            className={inStock ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" : ""}
          >
            {!buyable
              ? "Choose the options"
              : inStock
                ? stock <= 5
                  ? `Only ${stock} left in stock`
                  : "In stock"
                : "Out of stock"}
          </Badge>
        )}
        {selected?.label && <span className="text-sm text-muted-foreground" data-testid="selected-label">{selected.label}</span>}
      </div>

      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- the variation's own image, shown next to the options
        <img src={image} alt={selected?.label ?? ""} className="size-20 rounded-lg border object-cover" data-testid="variation-image" />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {inStock && buyable && <QuantityInput value={qty} onChange={setQty} max={manageStock ? stock : undefined} />}
        {buyable ? (
          <>
            <AddToCartButton
              product={product}
              variation={selected}
              quantity={qty}
              size="lg"
              className="min-w-40"
              manageStock={manageStock}
            />
            {inStock && <AddToCartButton product={product} variation={selected} quantity={qty} size="lg" mode="buy" className="min-w-32" manageStock={manageStock} />}
          </>
        ) : (
          // a variable product cannot be added before every attribute has a value
          <Button size="lg" className="min-w-40" isDisabled data-testid="choose-options">
            Choose the options
          </Button>
        )}
      </div>
    </div>
  );
}
