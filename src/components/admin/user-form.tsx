"use client";

import { useActionState } from "react";
import { updateUser, type AdminFormState } from "@/app/nemesis/actions";
import type { Profile } from "@/lib/types";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFormToast } from "./flash-toast";
import { CheckboxField, SubmitButton } from "./form-bits";

export function UserForm({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateUser, null);
  useFormToast(state);
  const v = state?.values ?? {};

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={profile.id} />
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="full_name">Full name</FieldLabel>
          <Input id="full_name" name="full_name" maxLength={120} defaultValue={v.full_name ?? profile.full_name ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">Phone</FieldLabel>
          <Input id="phone" name="phone" maxLength={40} defaultValue={v.phone ?? profile.phone ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">E-mail</FieldLabel>
          <Input id="email" value={profile.email ?? ""} disabled readOnly />
          <FieldDescription>Managed by Supabase Auth – users change it themselves.</FieldDescription>
        </Field>
        <CheckboxField
          id="is_admin"
          name="is_admin"
          label="Administrator"
          description={isSelf ? "That's you – you can't revoke your own access." : "Full access to this dashboard."}
          defaultChecked={state?.values ? v.is_admin === "on" : profile.is_admin}
        />
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save user
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
