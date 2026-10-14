"use client";

import { useActionState, useEffect, useState } from "react";
import { saveProduct, type AdminFormState } from "@/app/nemesis/actions";
import type { Category, Product } from "@/lib/types";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { useFormToast } from "./flash-toast";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, FieldError, SubmitButton } from "./form-bits";
import { UploadIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

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
  const previewSrc =
    imageMode === "upload" ? filePreview : imageMode === "url" ? urlValue || null : imageMode === "keep" ? currentImage : null;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="return_to" value={returnTo} />

      <div className="space-y-6">
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Details</h2>

          <div>
            <Label htmlFor="name" required>Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              defaultValue={v.name ?? product?.name ?? ""}
              onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)); }}
              aria-invalid={Boolean(err.name)}
            />
            <FieldError message={err.name} />
          </div>

          <div>
            <Label htmlFor="slug" required>Slug</Label>
            <div className="flex items-center gap-2">
              <span className="hidden shrink-0 text-sm text-neutral-400 sm:inline">/products/</span>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                aria-invalid={Boolean(err.slug)}
              />
            </div>
            <FieldError message={err.slug} />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={6} maxLength={5000} defaultValue={v.description ?? product?.description ?? ""} />
          </div>
        </section>

        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Pricing &amp; inventory</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="price" required>Price</Label>
              <Input
                id="price"
                name="price"
                inputMode="decimal"
                placeholder="19.99"
                required
                defaultValue={v.price ?? (product ? (product.price_cents / 100).toFixed(2) : "")}
                aria-invalid={Boolean(err.price)}
              />
              <FieldError message={err.price} />
            </div>
            <div>
              <Label htmlFor="compare_at_price">Compare-at price</Label>
              <Input
                id="compare_at_price"
                name="compare_at_price"
                inputMode="decimal"
                placeholder="Optional"
                defaultValue={v.compare_at_price ?? (product?.compare_at_price_cents != null ? (product.compare_at_price_cents / 100).toFixed(2) : "")}
                aria-invalid={Boolean(err.compare_at_price)}
              />
              <FieldError message={err.compare_at_price} />
              <p className="mt-1 text-xs text-neutral-500">Shown struck-through to mark a sale.</p>
            </div>
            <div>
              <Label htmlFor="stock" required>Stock</Label>
              <Input id="stock" name="stock" type="number" min={0} step={1} required defaultValue={v.stock ?? product?.stock ?? 0} aria-invalid={Boolean(err.stock)} />
              <FieldError message={err.stock} />
            </div>
          </div>

          <div>
            <Label htmlFor="category_id">Category</Label>
            <Select id="category_id" name="category_id" defaultValue={v.category_id ?? product?.category_id ?? ""} aria-invalid={Boolean(err.category_id)}>
              <option value="">— Uncategorised —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <FieldError message={err.category_id} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox name="is_active" label="Active" description="Visible in the shop and purchasable." defaultChecked={v.is_active ? true : product ? product.is_active : true} />
            <Checkbox name="is_featured" label="Featured" description="Shown on the home page." defaultChecked={v.is_featured ? true : (product?.is_featured ?? false)} />
          </div>
        </section>
      </div>

      {/* ── Image ─────────────────────────────────────────────────────────── */}
      <aside className="space-y-6">
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Image</h2>

          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-100">
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-center text-xs text-neutral-400">
                <span><UploadIcon className="mx-auto mb-2 h-6 w-6" />No image</span>
              </div>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="sr-only">Image source</legend>
            {(
              [
                currentImage ? { value: "keep", label: "Keep current image" } : null,
                { value: "upload", label: currentImage ? "Upload a new image" : "Upload an image" },
                { value: "url", label: "Use an image URL" },
                { value: "remove", label: currentImage ? "Remove image" : "No image" },
              ] as ({ value: ImageMode; label: string } | null)[]
            )
              .filter((o): o is { value: ImageMode; label: string } => o !== null)
              .map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    imageMode === o.value ? "border-brand-500 bg-brand-50" : "border-neutral-200 hover:bg-neutral-50",
                  )}
                >
                  <input type="radio" name="image_mode" value={o.value} checked={imageMode === o.value} onChange={() => setImageMode(o.value)} className="accent-brand-600" />
                  {o.label}
                </label>
              ))}
          </fieldset>

          {imageMode === "upload" && (
            <div>
              <Label htmlFor="image_file">Choose file</Label>
              <input
                id="image_file"
                name="image_file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFilePreview(f ? URL.createObjectURL(f) : null);
                }}
                aria-invalid={Boolean(err.image_file)}
              />
              <FieldError message={err.image_file} />
              <p className="mt-1 text-xs text-neutral-500">
                JPEG, PNG, WebP, GIF or AVIF · max 5 MB. {currentImage && "The previous upload is deleted automatically."}
              </p>
            </div>
          )}

          {imageMode === "url" && (
            <div>
              <Label htmlFor="image_url">Image URL</Label>
              <Input id="image_url" name="image_url" type="url" placeholder="https://…" value={urlValue} onChange={(e) => setUrlValue(e.target.value)} aria-invalid={Boolean(err.image_url)} />
              <FieldError message={err.image_url} />
            </div>
          )}
        </section>

        <div className="flex items-center gap-2">
          <SubmitButton className="flex-1" pendingLabel={isEdit ? "Saving…" : "Creating…"}>
            {isEdit ? "Save changes" : "Create product"}
          </SubmitButton>
          <ButtonLink href={returnTo} variant="outline">Cancel</ButtonLink>
        </div>
        {product && (
          <p className="text-xs text-neutral-500">
            View in store: <a href={`/products/${product.slug}`} target="_blank" rel="noreferrer" className="text-brand-700 dark:text-brand-300 hover:underline">/products/{product.slug}</a>
          </p>
        )}
      </aside>
    </form>
  );
}
