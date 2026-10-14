"use client";

import { useActionState } from "react";
import { updateUser, type AdminFormState } from "@/app/nemesis/actions";
import type { Profile } from "@/lib/types";
import { Input, Label } from "@/components/ui/field";
import { useFormToast } from "./flash-toast";
import { Checkbox, SubmitButton } from "./form-bits";

export function UserForm({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateUser, null);
  useFormToast(state);
  const v = state?.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={profile.id} />
      <div>
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" name="full_name" maxLength={120} defaultValue={v.full_name ?? profile.full_name ?? ""} />
      </div>
      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" maxLength={40} defaultValue={v.phone ?? profile.phone ?? ""} />
      </div>
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" value={profile.email ?? ""} disabled readOnly />
        <p className="mt-1 text-xs text-neutral-500">Managed by Supabase Auth – users change it themselves.</p>
      </div>
      <Checkbox
        name="is_admin"
        label="Administrator"
        description={isSelf ? "That's you – you can't revoke your own access." : "Full access to this dashboard."}
        defaultChecked={state?.values ? v.is_admin === "on" : profile.is_admin}
      />
      <SubmitButton className="w-full" pendingLabel="Saving…">Save user</SubmitButton>
    </form>
  );
}
