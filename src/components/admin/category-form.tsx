"use client";

import { useActionState, useState } from "react";
import { saveCategory, type AdminFormState } from "@/app/nemesis/actions";
import type { Category } from "@/lib/types";
import { LinkButton } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CategoryIconPicker } from "./category-icon-picker";
import { MediaRefField } from "./media/media-ref-field";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";

function slugify(input: string) {
  return input.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CategoryForm({ category, compact }: { category?: Category | null; compact?: boolean }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(saveCategory, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const [slugTouched, setSlugTouched] = useState(Boolean(category?.slug));
  const [slug, setSlug] = useState(v.slug ?? category?.slug ?? "");
  const prefix = compact ? "new-" : "";

  // The quick-add form stays on the list page: once an add succeeded, React resets the
  // uncontrolled inputs and the controlled slug starts over here (state keyed by the result).
  // `formRun` remounts the image field so a picked file starts over as well.
  const [seen, setSeen] = useState<AdminFormState>(state);
  const [formRun, setFormRun] = useState(0);
  if (seen !== state) {
    setSeen(state);
    if (state?.success) {
      setSlug("");
      setSlugTouched(false);
      setFormRun((run) => run + 1);
    }
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {category && <input type="hidden" name="id" value={category.id} />}
      {compact && !category && <input type="hidden" name="stay" value="true" />}
      <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-4"}>
        <Field data-invalid={Boolean(err.name) || undefined}>
          <FieldLabel htmlFor={`${prefix}name`}>Name</FieldLabel>
          <Input
            id={`${prefix}name`}
            name="name"
            required
            maxLength={100}
            placeholder="e.g. Apparel"
            defaultValue={v.name ?? category?.name ?? ""}
            onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)); }}
            aria-invalid={Boolean(err.name) || undefined}
          />
          <FieldError>{err.name}</FieldError>
        </Field>
        <Field data-invalid={Boolean(err.slug) || undefined}>
          <FieldLabel htmlFor={`${prefix}slug`}>Slug</FieldLabel>
          <Input id={`${prefix}slug`} name="slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} placeholder="apparel" aria-invalid={Boolean(err.slug) || undefined} />
          <FieldError>{err.slug}</FieldError>
        </Field>
      </div>
      <MediaRefField
        key={`image:${formRun}`}
        name="image"
        label="Category image & icons"
        currentUrl={category?.image_url ?? null}
        currentMedia={category?.image_media ?? null}
        error={err.image_media_id ?? err.image_url}
        allowUrl
        chooseLabel="Choose image"
        picker={{ kind: "image", title: "Category image", confirmLabel: "Use as category image", uploadFolderName: "categories" }}
        extra={
          <CategoryIconPicker
            key={`icon:${formRun}`}
            value={category?.icon ?? null}
            color={category?.icon_color ?? null}
            error={err.icon ?? err.icon_color}
          />
        }
      />
      <div className={compact ? "flex justify-end gap-2" : "flex gap-2"}>
        <SubmitButton pendingLabel={category ? "Saving…" : "Adding…"}>{category ? "Save changes" : "Add category"}</SubmitButton>
        {!compact && (
          <LinkButton href="/nemesis/categories" variant="outline">
            Cancel
          </LinkButton>
        )}
      </div>
    </form>
  );
}
