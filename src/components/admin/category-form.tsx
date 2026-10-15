"use client";

import { useActionState, useState } from "react";
import { saveCategory, type AdminFormState } from "@/app/nemesis/actions";
import type { Category } from "@/lib/types";
import { LinkButton } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFormToast } from "./flash-toast";
import { CheckboxField, SubmitButton } from "./form-bits";

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

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {category && <input type="hidden" name="id" value={category.id} />}
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
      <div className={compact ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "space-y-4"}>
        <CheckboxField
          id={`${prefix}show_in_menu`}
          name="show_in_menu"
          label="Show in header menu"
          defaultChecked={state?.values ? v.show_in_menu === "on" : (category?.show_in_menu ?? true)}
        />
        <div className="flex gap-2">
          <SubmitButton pendingLabel={category ? "Saving…" : "Adding…"}>{category ? "Save changes" : "Add category"}</SubmitButton>
          {!compact && (
            <LinkButton href="/nemesis/categories" variant="outline">
              Cancel
            </LinkButton>
          )}
        </div>
      </div>
    </form>
  );
}
