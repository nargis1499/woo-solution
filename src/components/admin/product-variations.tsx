"use client";

import { useMemo, useState } from "react";
import { ImageIcon, PlusIcon, SparklesIcon, Trash2Icon, WandSparklesIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_ATTRIBUTES,
  MAX_ATTRIBUTE_OPTIONS,
  combinationLabel,
  generateCombinations,
  sameCombination,
  suggestSku,
  usableAttributes,
  type DraftAttribute,
  type DraftVariation,
} from "@/lib/variations";
import { CURRENCIES, inputFromMicros, parseMoneyInput, type Money } from "@/lib/money";
import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { MediaItem, Product } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { MediaPickerDialog } from "./media/media-picker";

/* ── initial state from a saved product ─────────────────────────────────────── */

export function initialAttributes(product?: Product | null): DraftAttribute[] {
  return (product?.attributes ?? []).map((a) => ({ name: a.name, options: [...a.options] }));
}

export function initialVariations(product: Product | null | undefined, money: Money): DraftVariation[] {
  return (product?.variations ?? []).map((v) => ({
    key: v.id,
    id: v.id,
    sku: v.sku ?? "",
    price: inputFromMicros(v.price_micros, money),
    compareAtPrice: v.compare_at_price_micros != null ? inputFromMicros(v.compare_at_price_micros, money) : "",
    stock: String(v.stock),
    is_active: v.is_active,
    image_media_id: v.image_media_id ?? "",
    image_url: v.image_media_id ? "" : v.image_url ?? "",
    image_preview: v.image_url ?? "",
    combination: v.combination ?? {},
  }));
}

const newRow = (combination: Record<string, string>, money: Money, priceMicros: number, sku: string): DraftVariation => ({
  key: crypto.randomUUID(),
  sku,
  price: priceMicros > 0 ? inputFromMicros(priceMicros, money) : "",
  compareAtPrice: "",
  stock: "0",
  is_active: true,
  image_media_id: "",
  image_url: "",
  image_preview: "",
  combination,
});

/* ── attributes ────────────────────────────────────────────────────────────── */

/** Chip input: type a value and press Enter (or comma) to add it. */
function ValueChips({ id, label, values, onChange, disabled }: { id: string; label: string; values: string[]; onChange: (values: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const part of parts) {
      if (next.length >= MAX_ATTRIBUTE_OPTIONS) break;
      if (next.some((v) => v.toLowerCase() === part.toLowerCase())) continue;
      next.push(part);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-60",
      )}
      data-testid={`attribute-values-${id}`}
    >
      {values.map((value) => (
        <Badge key={value} variant="secondary" className="gap-1 pr-1">
          <span className="max-w-40 truncate">{value}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="rounded-full p-0.5 hover:bg-foreground/10"
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {values.length < MAX_ATTRIBUTE_OPTIONS && (
        <input
          className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          value={draft}
          aria-label={label}
          placeholder={values.length ? "Add value…" : "Red, Blue, Green…"}
          disabled={disabled}
          onChange={(e) => {
            // a comma ends the current value right away
            if (e.target.value.includes(",")) commit(e.target.value);
            else setDraft(e.target.value);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
      )}
    </div>
  );
}

function AttributesCard({
  attributes,
  onChange,
  error,
}: {
  attributes: DraftAttribute[];
  onChange: (attributes: DraftAttribute[]) => void;
  error?: string;
}) {
  const setRow = (index: number, patch: Partial<DraftAttribute>) =>
    onChange(attributes.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  return (
    <Card data-testid="product-attributes">
      <CardHeader>
        <CardTitle>Attributes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {attributes.map((attribute, index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,180px)_1fr_auto] sm:items-end" data-testid={`attribute-${index}`}>
            <Field>
              <FieldLabel htmlFor={`attribute-name-${index}`}>Attribute name</FieldLabel>
              <Input
                id={`attribute-name-${index}`}
                value={attribute.name}
                placeholder="Color"
                maxLength={60}
                onChange={(e) => setRow(index, { name: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`attribute-values-${index}`}>Values</FieldLabel>
              <ValueChips
                id={String(index)}
                label={`Values for attribute ${index + 1}`}
                values={attribute.options}
                onChange={(options) => setRow(index, { options })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove attribute ${attribute.name || index + 1}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(attributes.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}

        {attributes.length === 0 && <p className="text-sm text-muted-foreground">No attributes yet – add one (e.g. Color, Size) to build the variations.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" isDisabled={attributes.length >= MAX_ATTRIBUTES} onPress={() => onChange([...attributes, { name: "", options: [] }])}>
            <PlusIcon /> Add attribute
          </Button>
          <span className="text-xs text-muted-foreground">
            {attributes.length}/{MAX_ATTRIBUTES} attributes · up to {MAX_ATTRIBUTE_OPTIONS} values each
          </span>
        </div>
        <FieldError>{error}</FieldError>
      </CardContent>
    </Card>
  );
}

/* ── variations ────────────────────────────────────────────────────────────── */

function VariationsCard({
  product,
  attributes,
  variations,
  onChange,
  money,
  manageStock,
  baseSku,
  error,
}: {
  product?: Product | null;
  attributes: DraftAttribute[];
  variations: DraftVariation[];
  onChange: (rows: DraftVariation[]) => void;
  money: Money;
  manageStock: boolean;
  baseSku: string;
  error?: string;
}) {
  const symbol = CURRENCIES[money.currency].symbol;
  const names = useMemo(() => usableAttributes(attributes).map((a) => a.name), [attributes]);
  const combinations = useMemo(() => generateCombinations(attributes), [attributes]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkCompareAt, setBulkCompareAt] = useState("");
  const [bulkStock, setBulkStock] = useState("");

  const setRow = (key: string, patch: Partial<DraftVariation>) =>
    onChange(variations.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const enabled = variations.filter((row) => row.is_active).length;
  const priced = variations.filter((row) => row.is_active && (parseMoneyInput(row.price) ?? 0) > 0).length;

  function generate() {
    // Rows whose combination still exists keep their price / stock / image.
    const rows = combinations.map((combination) => {
      const existing = variations.find((row) => sameCombination(row.combination, combination));
      if (existing) return { ...existing, combination };
      const sku = suggestSku(baseSku, combination, names);
      return newRow(combination, money, product?.price_micros ?? 0, sku);
    });
    onChange(rows);
    setConfirmOpen(false);
  }

  const askGenerate = () => (variations.length ? setConfirmOpen(true) : generate());

  const applyPrice = () => {
    const value = bulkPrice.trim();
    if (!value) return;
    onChange(variations.map((row) => ({ ...row, price: value })));
  };
  const applyCompareAt = () => {
    const value = bulkCompareAt.trim();
    if (!value) return;
    onChange(variations.map((row) => ({ ...row, compareAtPrice: value })));
  };
  const applyStock = () => {
    const value = bulkStock.trim();
    if (!value) return;
    onChange(variations.map((row) => ({ ...row, stock: value })));
  };
  const autoSkus = () => {
    const seen = new Map<string, number>();
    onChange(
      variations.map((row) => {
        let sku = suggestSku(baseSku, row.combination, names);
        const count = (seen.get(sku) ?? 0) + 1;
        seen.set(sku, count);
        if (count > 1) sku = `${sku}-${count}`;
        return { ...row, sku };
      }),
    );
  };

  return (
    <Card data-testid="product-variations">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Variations
          <Badge variant="secondary" data-testid="variation-count">
            {variations.length} {variations.length === 1 ? "variation" : "variations"} · {enabled} enabled
          </Badge>
          {variations.length > 0 && priced < enabled && (
            <Badge variant="destructive" data-testid="variation-unpriced">
              {enabled - priced} without a price
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onPress={askGenerate} data-testid="generate-variations">
            <WandSparklesIcon /> Generate variations
          </Button>
          {variations.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onPress={autoSkus}>
              <SparklesIcon /> Auto SKUs
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {combinations.length ? `${combinations.length} possible combination${combinations.length === 1 ? "" : "s"}` : "Add an attribute with values first"}
          </span>
        </div>

        {variations.length > 0 && (
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <span className="text-xs font-medium sm:col-span-2 xl:col-span-4">Bulk edit – applies to every variation</span>
            <InputGroup data-testid="bulk-price">
              <InputGroupAddon>
                <InputGroupText>{symbol}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput value={bulkPrice} inputMode="decimal" aria-label="Price for all variations" placeholder="Set price…" onChange={(e) => setBulkPrice(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyPrice())} />
              <InputGroupAddon align="inline-end">
                <Button type="button" variant="ghost" size="sm" onPress={applyPrice} isDisabled={!bulkPrice.trim()}>
                  Apply
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <InputGroup data-testid="bulk-compare-at">
              <InputGroupAddon>
                <InputGroupText>{symbol}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput value={bulkCompareAt} inputMode="decimal" aria-label="Compare-at price for all variations" placeholder="Set compare-at…" onChange={(e) => setBulkCompareAt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCompareAt())} />
              <InputGroupAddon align="inline-end">
                <Button type="button" variant="ghost" size="sm" onPress={applyCompareAt} isDisabled={!bulkCompareAt.trim()}>
                  Apply
                </Button>
              </InputGroupAddon>
            </InputGroup>
            {manageStock && (
              <InputGroup data-testid="bulk-stock">
                <InputGroupAddon>
                  <InputGroupText>Stock</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput value={bulkStock} inputMode="numeric" aria-label="Stock for all variations" placeholder="Set stock…" onChange={(e) => setBulkStock(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyStock())} />
                <InputGroupAddon align="inline-end">
                  <Button type="button" variant="ghost" size="sm" onPress={applyStock} isDisabled={!bulkStock.trim()}>
                    Apply
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onPress={() => onChange(variations.map((row) => ({ ...row, is_active: true })))}>
                Enable all
              </Button>
              <Button type="button" variant="outline" size="sm" onPress={() => onChange(variations.map((row) => ({ ...row, is_active: false })))}>
                Disable all
              </Button>
            </div>
          </div>
        )}

        {variations.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-sm" data-testid="variations-table">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 font-medium">Combination</th>
                  <th className="px-2 font-medium">SKU</th>
                  <th className="px-2 font-medium">Price</th>
                  <th className="px-2 font-medium">Compare-at</th>
                  {manageStock && <th className="px-2 font-medium">Stock</th>}
                  <th className="px-2 font-medium">Image</th>
                  <th className="px-2 font-medium">Enabled</th>
                  <th className="px-2" />
                </tr>
              </thead>
              <tbody>
                {variations.map((row, index) => {
                  const label = combinationLabel(row.combination, names) || `Variation ${index + 1}`;
                  const stockNumber = Number(row.stock);
                  const outOfStock = manageStock && row.stock.trim() !== "" && Number.isFinite(stockNumber) && stockNumber <= 0;
                  return (
                    <tr key={row.key} className="bg-card align-middle" data-testid={`variation-row-${index}`}>
                      <td className="rounded-l-md border border-r-0 px-2 py-2">
                        <span className="font-medium">{label}</span>
                        {manageStock && row.is_active && outOfStock && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            Sold out
                          </Badge>
                        )}
                      </td>
                      <td className="border-y px-2 py-2">
                        <Input value={row.sku} aria-label={`SKU for ${label}`} placeholder="SKU" className="h-8 w-32" onChange={(e) => setRow(row.key, { sku: e.target.value })} />
                      </td>
                      <td className="border-y px-2 py-2">
                        <InputGroup className="w-28">
                          <InputGroupAddon>
                            <InputGroupText>{symbol}</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput value={row.price} inputMode="decimal" aria-label={`Price for ${label}`} placeholder="0.00" className="h-8" onChange={(e) => setRow(row.key, { price: e.target.value })} />
                        </InputGroup>
                      </td>
                      <td className="border-y px-2 py-2">
                        <InputGroup className="w-28">
                          <InputGroupAddon>
                            <InputGroupText>{symbol}</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput value={row.compareAtPrice} inputMode="decimal" aria-label={`Compare-at price for ${label}`} placeholder="—" className="h-8" onChange={(e) => setRow(row.key, { compareAtPrice: e.target.value })} />
                        </InputGroup>
                      </td>
                      {manageStock && (
                        <td className="border-y px-2 py-2">
                          <Input value={row.stock} inputMode="numeric" aria-label={`Stock for ${label}`} className="h-8 w-20" onChange={(e) => setRow(row.key, { stock: e.target.value.replace(/[^\d]/g, "") })} />
                        </td>
                      )}
                      <td className="border-y px-2 py-2">
                        <div className="flex items-center gap-1">
                          {row.image_preview ? (
                            // eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail
                            <img src={row.image_preview} alt="" className="size-8 rounded object-cover" data-testid={`variation-image-${index}`} />
                          ) : (
                            <span className="grid size-8 place-items-center rounded border text-muted-foreground">
                              <ImageIcon className="size-3.5" />
                            </span>
                          )}
                          <Button type="button" variant="ghost" size="sm" aria-label={`Choose image for ${label}`} onPress={() => setPickerFor(row.key)}>
                            Choose
                          </Button>
                          {(row.image_media_id || row.image_url || row.image_preview) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove image for ${label}`}
                              className="text-muted-foreground hover:text-destructive"
                              onPress={() => setRow(row.key, { image_media_id: "", image_url: "", image_preview: "" })}
                            >
                              <XIcon />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="border-y px-2 py-2">
                        <Switch
                          isSelected={row.is_active}
                          onChange={(active) => setRow(row.key, { is_active: active })}
                          aria-label={`${row.is_active ? "Disable" : "Enable"} ${label}`}
                          data-testid={`variation-enabled-${index}`}
                        />
                      </td>
                      <td className="rounded-r-md border border-l-0 px-2 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${label}`}
                          className="text-muted-foreground hover:text-destructive"
                          onPress={() => onChange(variations.filter((r) => r.key !== row.key))}
                        >
                          <Trash2Icon />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {variations.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No variations yet – define your attributes above, then hit <span className="font-medium">Generate variations</span> to build every combination.
          </p>
        )}

        <FieldError>{error}</FieldError>

        <AlertDialog isOpen={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace the current variations?</AlertDialogTitle>
              <AlertDialogDescription>
                Generating rebuilds the list from the attributes above. The {variations.length} existing {variations.length === 1 ? "variation" : "variations"} that still match a combination keep
                their price, stock and image; the others are dropped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onPress={generate} data-testid="confirm-generate">
                Generate variations
              </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialog>

        <MediaPickerDialog
          isOpen={pickerFor !== null}
          onOpenChange={(open) => !open && setPickerFor(null)}
          kind="image"
          uploadFolderName="Products"
          title="Variation image"
          confirmLabel="Use image"
          onSelect={(items: MediaItem[]) => {
            const file = items[0];
            if (!file || !pickerFor) return;
            setRow(pickerFor, {
              image_media_id: file.id,
              image_url: "",
              image_preview: mediaPreviewUrl(file, "thumbnail") ?? mediaUrl(file.path),
            });
            setPickerFor(null);
          }}
        />
      </CardContent>
    </Card>
  );
}

/* ── public entry point ────────────────────────────────────────────────────── */

/**
 * The two cards a variable product needs: the attributes that define its axes and the
 * grid of combinations with their own SKU / price / stock / image / enabled flag.
 * State lives in `ProductForm`, which serialises it into hidden inputs on submit.
 */
export function VariableProductFields({
  product,
  attributes,
  variations,
  onAttributesChange,
  onVariationsChange,
  money,
  manageStock,
  baseSku,
  errors,
}: {
  product?: Product | null;
  attributes: DraftAttribute[];
  variations: DraftVariation[];
  onAttributesChange: (attributes: DraftAttribute[]) => void;
  onVariationsChange: (variations: DraftVariation[]) => void;
  money: Money;
  manageStock: boolean;
  /** Prefix for suggested SKUs (the product SKU / slug). */
  baseSku: string;
  errors: Record<string, string | undefined>;
}) {
  return (
    <>
      <AttributesCard attributes={attributes} onChange={onAttributesChange} error={errors.attributes} />
      <VariationsCard
        product={product}
        attributes={attributes}
        variations={variations}
        onChange={onVariationsChange}
        money={money}
        manageStock={manageStock}
        baseSku={baseSku}
        error={errors.variations}
      />
      <p className="px-1 text-xs text-muted-foreground">
        A variable product shows “From …” in the shop using its cheapest enabled variation — the storefront price, stock and image
        follow the combination the customer picks.
      </p>
    </>
  );
}
