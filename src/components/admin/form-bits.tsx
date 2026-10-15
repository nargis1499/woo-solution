"use client";

import { useId, useOptimistic, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant = "default",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} isPending={pending} className={className} aria-busy={pending}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * Delete button that asks for confirmation in an alert dialog, then runs the
 * server action (which redirects back with a toast). Pending state stays
 * visible inside the dialog until the new page arrives.
 */
export function DeleteButton({
  action,
  id,
  returnTo,
  title,
  description,
  label = "Delete",
  size = "sm",
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  returnTo?: string;
  title: string;
  description: string;
  label?: string;
  size?: "sm" | "default";
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      if (returnTo) formData.set("return_to", returnTo);
      await action(formData);
    });
  }

  return (
    <AlertDialogTrigger>
      <Button variant="destructive" size={size} aria-label={label}>
        <Trash2Icon />
        {label}
      </Button>
      <AlertDialog isDismissable={!pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel isDisabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onPress={confirm} isPending={pending} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialog>
    </AlertDialogTrigger>
  );
}

/** Labelled checkbox card (`name` is submitted as "on" when selected). */
export function CheckboxField({
  name,
  label,
  description,
  defaultChecked,
  id,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `${name}-${autoId}`;
  return (
    <FieldLabel htmlFor={inputId}>
      <Field orientation="horizontal">
        <Checkbox id={inputId} name={name} defaultSelected={defaultChecked} />
        <FieldContent>
          <FieldTitle>{label}</FieldTitle>
          {description && <FieldDescription>{description}</FieldDescription>}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

/** Switch that flips `categories.show_in_menu` through a server action; optimistic until the page refreshes. */
export function MenuToggle({ id, shown, name, action }: { id: string; shown: boolean; name: string; action: (formData: FormData) => void | Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(shown);

  return (
    <Switch
      isSelected={optimistic}
      isDisabled={pending}
      aria-label={optimistic ? `Hide "${name}" from the header menu` : `Show "${name}" in the header menu`}
      onChange={(next) => {
        startTransition(async () => {
          setOptimistic(next);
          const formData = new FormData();
          formData.set("id", id);
          await action(formData);
        });
      }}
    />
  );
}
