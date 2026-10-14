"use client";

import { useActionState } from "react";
import { updateSiteSettings, type AdminFormState } from "@/app/nemesis/actions";
import type { SiteSettings } from "@/lib/types";
import { Input, Label } from "@/components/ui/field";
import { useFormToast } from "./flash-toast";
import { FieldError, SubmitButton } from "./form-bits";

export function SettingsForm({ settings }: { settings: SiteSettings }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateSiteSettings, null);
  useFormToast(state);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div>
        <Label htmlFor="store_name" required>Site title</Label>
        <Input id="store_name" name="store_name" required maxLength={60} defaultValue={v.store_name ?? settings.store_name} aria-invalid={Boolean(err.store_name)} />
        <FieldError message={err.store_name} />
        <p className="mt-1 text-xs text-neutral-500">Shown in the header, footer, browser tab and e-mails.</p>
      </div>
      <div>
        <Label htmlFor="tagline">Tagline</Label>
        <Input id="tagline" name="tagline" maxLength={160} placeholder="A modern storefront built with Next.js and Supabase." defaultValue={v.tagline ?? settings.tagline ?? ""} />
        <p className="mt-1 text-xs text-neutral-500">Shown in the footer and used as the site description for search engines and link previews.</p>
      </div>
      <div>
        <Label htmlFor="support_email">Support e-mail</Label>
        <Input id="support_email" name="support_email" type="email" maxLength={120} placeholder="help@example.com" defaultValue={v.support_email ?? settings.support_email ?? ""} aria-invalid={Boolean(err.support_email)} />
        <FieldError message={err.support_email} />
        <p className="mt-1 text-xs text-neutral-500">Displayed in the footer so customers can reach you.</p>
      </div>
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
