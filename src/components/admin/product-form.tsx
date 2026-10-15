"use client";

import { useActionState, useEffect, useState } from "react";
import { ImageIcon, LinkIcon, UploadIcon, XIcon } from "lucide-react";
import { saveProduct, type AdminFormState } from "@/app/nemesis/actions";
import type { Category, Product } from "@/lib/types";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormToast } from "./flash-toast";
import { CheckboxField, SubmitButton } from "./form-bits";

type ImageMode = "keep" | "upload" | "url" | "remove";

function slugify(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ProductForm({
  product,
  categories,
  returnTo = "/nemesis/products",
}: {
  product?: Product | null;
  categories: Category[];
  /** List URL (page / size / filter) to go back to after saving or cancelling. */
  returnTo?: string;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(saveProduct, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const isEdit = Boolean(product);

  // slug auto-follows the name until the user edits the slug by hand
  const [slugTouched, setSlugTouched] = useState(Boolean(product?.slug));
  const [slug, setSlug] = useState(v.slug ?? product?.slug ?? "");

  const [imageMode, setImageMode] = useState<ImageMode>((v.image_mode as ImageMode) || (product?.image_url ? "keep" : "remove"));
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState(v.image_url ?? "");
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  const currentImage = product?.image_url ?? null;
  const previewSrc = imageMode === "upload" ? filePreview : imageMode === "url" ? urlValue || null : imageMode === "keep" ? currentImage : null;

  const imageOptions = (
    [
      currentImage ? { value: "keep", label: "Keep", icon: ImageIcon } : null,
      { value: "upload", label: "Upload", icon: UploadIcon },
      { value: "url", label: "URL", icon: LinkIcon },
      { value: "remove", label: currentImage ? "Remove" : "None", icon: XIcon },
    ] as ({ value: ImageMode; label: string; icon: typeof ImageIcon } | null)[]
  ).filter((o): o is { value: ImageMode; label: string; icon: typeof ImageIcon } => o !== null);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="image_mode" value={imageMode} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(err.name) || undefined}>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={v.name ?? product?.name ?? ""}
                  onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)); }}
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
                <Textarea id="description" name="description" rows={6} maxLength={5000} defaultValue={v.description ?? product?.description ?? ""} />
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
              <div className="grid gap-4 sm:grid-cols-3">
                <Field data-invalid={Boolean(err.price) || undefined}>
                  <FieldLabel htmlFor="price">Price</FieldLabel>
                  <Input id="price" name="price" inputMode="decimal" placeholder="19.99" required defaultValue={v.price ?? (product ? (product.price_cents / 100).toFixed(2) : "")} aria-invalid={Boolean(err.price) || undefined} />
                  <FieldError>{err.price}</FieldError>
                </Field>
                <Field data-invalid={Boolean(err.compare_at_price) || undefined}>
                  <FieldLabel htmlFor="compare_at_price">Compare-at price</FieldLabel>
                  <Input
                    id="compare_at_price"
                    name="compare_at_price"
                    inputMode="decimal"
                    placeholder="Optional"
                    defaultValue={v.compare_at_price ?? (product?.compare_at_price_cents != null ? (product.compare_at_price_cents / 100).toFixed(2) : "")}
                    aria-invalid={Boolean(err.compare_at_price) || undefined}
                  />
                  <FieldError>{err.compare_at_price}</FieldError>
                  <FieldDescription>Shown struck-through to mark a sale.</FieldDescription>
                </Field>
                <Field data-invalid={Boolean(err.stock) || undefined}>
                  <FieldLabel htmlFor="stock">Stock</FieldLabel>
                  <Input id="stock" name="stock" type="number" min={0} step={1} required defaultValue={v.stock ?? product?.stock ?? 0} aria-invalid={Boolean(err.stock) || undefined} />
                  <FieldError>{err.stock}</FieldError>
                </Field>
              </div>
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
      </div>

      {/* ── Image ─────────────────────────────────────────────────────────── */}
      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Image</CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-dashed bg-muted">
              {previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
                  <span>
                    <ImageIcon className="mx-auto mb-2 size-6" />
                    No image
                  </span>
                </div>
              )}
            </div>
            <ToggleGroup
              aria-label="Image source"
              variant="outline"
              spacing={0}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[imageMode]}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next != null) setImageMode(String(next) as ImageMode);
              }}
              className="w-full"
            >
              {imageOptions.map((o) => (
                <ToggleGroupItem key={o.value} id={o.value} className="flex-1" aria-label={o.label}>
                  <o.icon /> {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {imageMode === "upload" && (
              <Field data-invalid={Boolean(err.image_file) || undefined}>
                <FieldLabel htmlFor="image_file">Choose file</FieldLabel>
                <Input
                  id="image_file"
                  name="image_file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  className="file:mr-3 file:rounded-sm file:bg-primary file:px-2 file:text-primary-foreground"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFilePreview(f ? URL.createObjectURL(f) : null);
                  }}
                  aria-invalid={Boolean(err.image_file) || undefined}
                />
                <FieldError>{err.image_file}</FieldError>
                <FieldDescription>JPEG, PNG, WebP, GIF or AVIF · max 5 MB. {currentImage && "The previous upload is deleted automatically."}</FieldDescription>
              </Field>
            )}
            {imageMode === "url" && (
              <Field data-invalid={Boolean(err.image_url) || undefined}>
                <FieldLabel htmlFor="image_url">Image URL</FieldLabel>
                <Input id="image_url" name="image_url" type="url" placeholder="https://…" value={urlValue} onChange={(e) => setUrlValue(e.target.value)} aria-invalid={Boolean(err.image_url) || undefined} />
                <FieldError>{err.image_url}</FieldError>
              </Field>
            )}
          </CardContent>
        </Card>

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
