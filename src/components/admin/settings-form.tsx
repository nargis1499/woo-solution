"use client";

import { useActionState } from "react";
import { updateSiteSettings, type AdminFormState } from "@/app/nemesis/actions";
import type { SiteSettings } from "@/lib/types";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFormToast } from "./flash-toast";
import { SubmitButton } from "./form-bits";

export function SettingsForm({ settings }: { settings: SiteSettings }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateSiteSettings, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      <FieldGroup className="gap-5">
        <Field data-invalid={Boolean(err.store_name) || undefined}>
          <FieldLabel htmlFor="store_name">Site title</FieldLabel>
          <Input id="store_name" name="store_name" required maxLength={60} defaultValue={v.store_name ?? settings.store_name} aria-invalid={Boolean(err.store_name) || undefined} />
          <FieldError>{err.store_name}</FieldError>
          <FieldDescription>Shown in the header, footer, browser tab and e-mails.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="tagline">Tagline</FieldLabel>
          <Input id="tagline" name="tagline" maxLength={160} placeholder="A modern storefront built with Next.js and Supabase." defaultValue={v.tagline ?? settings.tagline ?? ""} />
          <FieldDescription>Shown in the footer and used as the site description for search engines and link previews.</FieldDescription>
        </Field>
        <Field data-invalid={Boolean(err.support_email) || undefined}>
          <FieldLabel htmlFor="support_email">Support e-mail</FieldLabel>
          <Input id="support_email" name="support_email" type="email" maxLength={120} placeholder="help@example.com" defaultValue={v.support_email ?? settings.support_email ?? ""} aria-invalid={Boolean(err.support_email) || undefined} />
          <FieldError>{err.support_email}</FieldError>
          <FieldDescription>Displayed in the footer so customers can reach you.</FieldDescription>
        </Field>
        <div>
          <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
