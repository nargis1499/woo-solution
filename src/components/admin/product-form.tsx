"use client";

import { useActionState, useState } from "react";
import { XIcon } from "lucide-react";
import { saveProduct, type AdminFormState } from "@/app/nemesis/actions";
import { CURRENCIES, DEFAULT_PRICE_MICROS, inputFromMicros } from "@/lib/money";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "./flash-toast";
import { CheckboxField, SubmitButton } from "./form-bits";
import { VariableProductFields, initialAttributes, initialVariations } from "./product-variations";
import { submittedVariations, type DraftAttribute, type DraftVariation } from "@/lib/variations";
import { ProductMediaFields } from "./media/product-media-fields";

function slugify(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ProductForm({
  product,
  categories,
  returnTo = "/nemesis/products",
  manageStock = true,
}: {
  product?: Product | null;
  categories: Category[];
  /** List URL (page / size / filter) to go back to after saving or cancelling. */
  returnTo?: string;
  /** Settings → WooCommerce → stock management; when off the stock field is hidden and left untouched. */
  manageStock?: boolean;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(saveProduct, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const isEdit = Boolean(product);

  // slug auto-follows the name until the user edits the slug by hand
  const [slugTouched, setSlugTouched] = useState(Boolean(product?.slug));
  const [slug, setSlug] = useState(v.slug ?? product?.slug ?? "");
  const [name, setName] = useState(v.name ?? product?.name ?? "");

  // Simple (one price + stock) or variable (attributes → generated variations).
  // Prices are stored in USD micros and shown in the store currency (Settings → WooCommerce).
  // The form tells the action which currency/rate it displayed, and what it displayed, so
  // untouched prices are stored back exactly and edited ones are converted with the same rate.
  const money = useMoney();
  const symbol = CURRENCIES[money.currency].symbol;

  const [type, setType] = useState<"simple" | "variable">((v.type as "simple" | "variable") ?? product?.type ?? "simple");
  const [sku, setSku] = useState(v.sku ?? product?.sku ?? "");
  const [brand, setBrand] = useState(v.brand ?? product?.brand ?? "");
  const [features, setFeatures] = useState<string[]>(() =>
    (v.features ?? product?.features ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const [featureDraft, setFeatureDraft] = useState("");
  const [attributes, setAttributes] = useState<DraftAttribute[]>(() => (v.attributes_json ? (JSON.parse(v.attributes_json) as DraftAttribute[]) : initialAttributes(product)));
  const [variations, setVariations] = useState<DraftVariation[]>(() => (v.variations_json ? (JSON.parse(v.variations_json) as DraftVariation[]).map((row) => ({ ...row, key: row.id ?? crypto.randomUUID(), image_preview: row.image_url ?? "" })) : initialVariations(product, money)));

  function commitFeatures(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setFeatures((prev) => {
      const next = [...prev];
      for (const part of parts) {
        if (next.some((item) => item.toLowerCase() === part.toLowerCase())) continue;
        next.push(part);
      }
      return next;
    });
    setFeatureDraft("");
  }

  function removeFeature(index: number) {
    setFeatures((prev) => prev.filter((_, i) => i !== index));
  }

  const serializedFeatures = [
    ...features,
    ...featureDraft
      .split(",")
      .map((p) => p.trim())
      .filter(
        (p) =>
          Boolean(p) &&
          !features.some((item) => item.toLowerCase() === p.toLowerCase()),
      ),
  ]
    .join(", ")
    .slice(0, 500);

  const gallery = (product?.gallery ?? []).flatMap((g) => (g.media ? [g.media] : []));

  // A saved product is on sale when its regular price (compare_at) sits above what it charges.
  const hasSale = product?.compare_at_price_micros != null && (product.compare_at_price_micros as number) > product.price_micros;
  const regularShown = product ? inputFromMicros(hasSale ? (product.compare_at_price_micros as number) : product.price_micros, money) : "";
  const saleShown = hasSale ? inputFromMicros(product!.price_micros, money) : "";

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="money_currency" value={money.currency} />
      <input type="hidden" name="money_rate" value={String(money.rate)} />
      <input type="hidden" name="regular_price_shown" value={regularShown} />
      <input type="hidden" name="sale_price_shown" value={saleShown} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="attributes_json" value={JSON.stringify(attributes)} data-testid="attributes-json" />
      <input type="hidden" name="variations_json" value={JSON.stringify(submittedVariations(variations))} data-testid="variations-json" />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(err.type) || undefined}>
                  <FieldLabel htmlFor="product_type">Product type</FieldLabel>
                  <Select
                    name="product_type"
                    defaultSelectedKey={type}
                    onSelectionChange={(key) => setType(String(key) as "simple" | "variable")}
                    aria-label="Product type"
                    isInvalid={Boolean(err.type)}
                  >
                    <SelectTrigger id="product_type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem id="simple">Simple product</SelectItem>
                      <SelectItem id="variable">Variable product</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldError>{err.type}</FieldError>
                </Field>
                <Field data-invalid={Boolean(err.brand) || undefined}>
                  <FieldLabel htmlFor="brand">Brand</FieldLabel>
                  <Input
                    id="brand"
                    name="brand"
                    maxLength={80}
                    placeholder="e.g. Apple, Sony, Asus, Samsung"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    aria-invalid={Boolean(err.brand) || undefined}
                  />
                  <FieldError>{err.brand}</FieldError>
                </Field>
              </div>
              <Field data-invalid={Boolean(err.name) || undefined}>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }}
                  aria-invalid={Boolean(err.name) || undefined}
                />
                <FieldError>{err.name}</FieldError>
              </Field>
              <Field data-invalid={Boolean(err.slug) || undefined}>
                <FieldLabel htmlFor="slug">Slug</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>/products/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="slug"
                    name="slug"
                    value={slug}
                    onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    aria-invalid={Boolean(err.slug) || undefined}
                  />
                </InputGroup>
                <FieldError>{err.slug}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea id="description" name="description" rows={5} maxLength={5000} defaultValue={v.description ?? product?.description ?? ""} />
              </Field>
              <Field data-invalid={Boolean(err.features) || undefined}>
                <FieldLabel htmlFor="features_input">Product Features</FieldLabel>
                <input
                  type="hidden"
                  name="features"
                  value={serializedFeatures}
                  data-testid="features-hidden"
                />
                <div
                  data-testid="product-features-box"
                  className={cn(
                    "flex min-h-11 w-full flex-wrap items-center gap-2 rounded-xl border border-input bg-transparent p-2.5 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
                    err.features && "border-destructive ring-destructive/20",
                  )}
                >
                  {features.map((feature, index) => (
                    <span
                      key={`${feature}-${index}`}
                      data-testid="product-feature-chip"
                      className="inline-flex items-center gap-2 rounded-lg bg-muted/80 px-3 py-1.5 text-sm font-semibold text-foreground"
                    >
                      <span>{feature}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${feature}`}
                        onClick={() => removeFeature(index)}
                        className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <XIcon className="size-4" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="features_input"
                    type="text"
                    value={featureDraft}
                    placeholder="Add another Feature"
                    aria-invalid={Boolean(err.features) || undefined}
                    onChange={(e) => {
                      if (e.target.value.includes(",")) {
                        commitFeatures(e.target.value);
                      } else {
                        setFeatureDraft(e.target.value);
                      }
                    }}
                    onBlur={() => commitFeatures(featureDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitFeatures(featureDraft);
                      } else if (
                        e.key === "Backspace" &&
                        !featureDraft &&
                        features.length > 0
                      ) {
                        removeFeature(features.length - 1);
                      }
                    }}
                    className="min-w-44 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <FieldError>{err.features}</FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing &amp; inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              {type === "variable" ? null : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field data-invalid={Boolean(err.regular_price) || undefined}>
                  <FieldLabel htmlFor="regular_price">Regular price ({money.currency})</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText data-testid="regular-price-currency">{symbol}</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="regular_price"
                      name="regular_price"
                      inputMode="decimal"
                      placeholder={inputFromMicros(DEFAULT_PRICE_MICROS, money)}
                      required
                      defaultValue={v.regular_price ?? regularShown}
                      aria-invalid={Boolean(err.regular_price) || undefined}
                    />
                  </InputGroup>
                  <FieldError>{err.regular_price}</FieldError>
                </Field>
                <Field data-invalid={Boolean(err.sale_price) || undefined}>
                  <FieldLabel htmlFor="sale_price">Sale price ({money.currency})</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText data-testid="sale-price-currency">{symbol}</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="sale_price"
                      name="sale_price"
                      inputMode="decimal"
                      placeholder="Optional"
                      defaultValue={v.sale_price ?? saleShown}
                      aria-invalid={Boolean(err.sale_price) || undefined}
                    />
                  </InputGroup>
                  <FieldError>{err.sale_price}</FieldError>
                </Field>
                {manageStock ? (
                  <Field data-invalid={Boolean(err.stock) || undefined}>
                    <FieldLabel htmlFor="stock">Stock</FieldLabel>
                    <Input id="stock" name="stock" type="number" min={0} step={1} required defaultValue={v.stock ?? product?.stock ?? 0} aria-invalid={Boolean(err.stock) || undefined} />
                    <FieldError>{err.stock}</FieldError>
                  </Field>
                ) : (
                  // stock management is off – keep the stored quantity as-is
                  <input type="hidden" name="stock" value={product?.stock ?? 0} />
                )}
              </div>
              )}
              <Field data-invalid={Boolean(err.sku) || undefined}>
                <FieldLabel htmlFor="sku">SKU</FieldLabel>
                <Input
                  id="sku"
                  name="sku"
                  value={sku}
                  maxLength={64}
                  placeholder={type === "variable" ? "Used as the prefix for variation SKUs" : "Optional, e.g. TEE-001"}
                  onChange={(e) => setSku(e.target.value)}
                  aria-invalid={Boolean(err.sku) || undefined}
                />
                <FieldError>{err.sku}</FieldError>
              </Field>
              <Field data-invalid={Boolean(err.category_id) || undefined}>
                <FieldLabel htmlFor="category_id">Category</FieldLabel>
                <Select name="category_id" defaultSelectedKey={v.category_id ?? product?.category_id ?? ""} aria-label="Category" isInvalid={Boolean(err.category_id)}>
                  <SelectTrigger id="category_id" className="w-full sm:max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem id="">— Uncategorised —</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} id={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{err.category_id}</FieldError>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <CheckboxField id="is_active" name="is_active" label="Active" description="Visible in the shop and purchasable." defaultChecked={v.is_active ? true : product ? product.is_active : true} />
                <CheckboxField id="is_featured" name="is_featured" label="Featured" description="Shown on the home page." defaultChecked={v.is_featured ? true : (product?.is_featured ?? false)} />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* ── Variable products: attributes → generated variations ──────────── */}
        {type === "variable" && (
          <VariableProductFields
            product={product}
            attributes={attributes}
            variations={variations}
            onAttributesChange={setAttributes}
            onVariationsChange={setVariations}
            money={money}
            manageStock={manageStock}
            baseSku={sku || product?.sku || slug || name}
            errors={err}
          />
        )}
      </div>

      {/* ── Image + gallery (Media Library) ───────────────────────────────── */}
      <aside className="space-y-6">
        <ProductMediaFields currentUrl={product?.image_url ?? null} currentMedia={product?.image_media ?? null} gallery={gallery} errors={err} />

        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1" pendingLabel={isEdit ? "Saving…" : "Creating…"}>
            {isEdit ? "Save changes" : "Create product"}
          </SubmitButton>
          <LinkButton href={returnTo} variant="outline">
            Cancel
          </LinkButton>
        </div>
        {product && (
          <p className="text-xs text-muted-foreground">
            View in store:{" "}
            <a href={`/products/${product.slug}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              /products/{product.slug}
            </a>
          </p>
        )}
      </aside>
    </form>
  );
}
