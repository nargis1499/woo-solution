"use client";

import { useActionState, useEffect, useState } from "react";
import { SquarePenIcon } from "lucide-react";
import { updateMenuItem } from "@/app/nemesis/ui/actions";
import type { AdminFormState } from "@/lib/admin/form";
import { MENU_KIND_LABELS, MENU_TITLE_MAX } from "@/lib/menu-config";
import type { MenuItem } from "@/lib/types";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton, SwitchField } from "@/components/admin/form-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** "Edit" button of a menu row: link text, URL (custom links) and the new-tab flag in a small dialog. */
export function MenuItemEditButton({ item, href }: { item: MenuItem; href: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="outline" size="icon-sm" aria-label={`Edit "${item.title}"`}>
        <SquarePenIcon className="size-4" />
      </Button>
      {/* The form mounts fresh every time the dialog opens, so old validation errors never linger. */}
      {open && <EditForm item={item} href={href} onSaved={() => setOpen(false)} />}
    </DialogTrigger>
  );
}

function EditForm({ item, href, onSaved }: { item: MenuItem; href: string | null; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(updateMenuItem, null);
  useFormToast(state);
  useEffect(() => {
    if (state?.success) onSaved();
  }, [state, onSaved]);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const draft = item.kind === "page" && item.page?.status !== "published";

  return (
    <Dialog isDismissable={!pending} className="sm:max-w-md" data-testid="menu-item-edit">
      <DialogHeader>
        <DialogTitle>Edit menu item</DialogTitle>
        <DialogDescription>
          {MENU_KIND_LABELS[item.kind]}
          {item.kind !== "custom" && href ? ` · links to ${href}` : ""}
          {draft ? " · draft page, hidden in the storefront until it is published" : ""}
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="id" value={item.id} />
        <Field data-invalid={Boolean(err.title) || undefined}>
          <FieldLabel htmlFor="menu-edit-title">Link text</FieldLabel>
          <Input id="menu-edit-title" name="title" maxLength={MENU_TITLE_MAX} required defaultValue={v.title ?? item.title} aria-invalid={Boolean(err.title) || undefined} autoFocus />
          <FieldError>{err.title}</FieldError>
        </Field>
        {item.kind === "custom" && (
          <Field data-invalid={Boolean(err.url) || undefined}>
            <FieldLabel htmlFor="menu-edit-url">URL</FieldLabel>
            <Input id="menu-edit-url" name="url" inputMode="url" defaultValue={v.url ?? item.url ?? ""} aria-invalid={Boolean(err.url) || undefined} />
            <FieldError>{err.url}</FieldError>
          </Field>
        )}
        <SwitchField id="menu-edit-new-tab" name="open_in_new_tab" label="Open in a new tab" defaultSelected={v.open_in_new_tab ? v.open_in_new_tab === "on" : item.open_in_new_tab} />
        <DialogFooter>
          <DialogClose isDisabled={pending}>Cancel</DialogClose>
          <SubmitButton pending={pending}>Save</SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
