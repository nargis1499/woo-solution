"use client";

import { useActionState, useState } from "react";
import { saveCategory, type AdminFormState } from "@/app/nemesis/actions";
import type { Category } from "@/lib/types";
import { Input, Label } from "@/components/ui/field";
import { useFormToast } from "./flash-toast";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, FieldError, SubmitButton } from "./form-bits";

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

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {category && <input type="hidden" name="id" value={category.id} />}
      <div className={compact ? "grid gap-3 sm:grid-cols-[1fr_1fr_120px]" : "space-y-4"}>
        <div>
          <Label htmlFor={`${compact ? "new-" : ""}name`} required>Name</Label>
          <Input
            id={`${compact ? "new-" : ""}name`}
            name="name"
            required
            maxLength={100}
            placeholder="e.g. Apparel"
            defaultValue={v.name ?? category?.name ?? ""}
            onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)); }}
            aria-invalid={Boolean(err.name)}
          />
          <FieldError message={err.name} />
        </div>
        <div>
          <Label htmlFor={`${compact ? "new-" : ""}slug`} required>Slug</Label>
          <Input
            id={`${compact ? "new-" : ""}slug`}
            name="slug"
            value={slug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
            placeholder="apparel"
            aria-invalid={Boolean(err.slug)}
          />
          <FieldError message={err.slug} />
        </div>
        <div>
          <Label htmlFor={`${compact ? "new-" : ""}sort_order`}>Sort order</Label>
          <Input id={`${compact ? "new-" : ""}sort_order`} name="sort_order" type="number" step={1} defaultValue={v.sort_order ?? category?.sort_order ?? 0} aria-invalid={Boolean(err.sort_order)} />
          <FieldError message={err.sort_order} />
        </div>
      </div>
      <div className={compact ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "space-y-4"}>
        <Checkbox
          name="show_in_menu"
          label="Show in header menu"
          description="List this category in the storefront's main navigation."
          defaultChecked={state?.values ? v.show_in_menu === "on" : (category?.show_in_menu ?? true)}
        />
        <div className="flex gap-2">
          <SubmitButton pendingLabel={category ? "Saving…" : "Adding…"}>{category ? "Save changes" : "Add category"}</SubmitButton>
          {!compact && <ButtonLink href="/nemesis/categories" variant="outline">Cancel</ButtonLink>}
        </div>
      </div>
    </form>
  );
}
