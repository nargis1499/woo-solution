"use client";

import { useId, useState, useTransition } from "react";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AdminFormState } from "@/lib/admin/form";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant = "default",
  className,
  pending: pendingProp,
  disabled,
  ...props
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
  className?: string;
  /** Forms that dispatch their action manually (no `<form action>`) pass `isPending` from useActionState here. */
  pending?: boolean;
  /** Nothing to submit yet (e.g. an empty picker). */
  disabled?: boolean;
} & { "data-testid"?: string; id?: string }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" variant={variant} isPending={pending} isDisabled={disabled} className={className} aria-busy={pending} {...props}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * Opens `href` in a new tab when pressed.
 *
 * A plain `<a target="_blank">` does not work inside a *linked* DataGrid row (the row's own
 * React Aria press handling swallows the click, so neither the link nor the row navigates).
 * Doing it from a pressable Button keeps the link alive inside those rows.
 */
export function OpenTabButton({
  href,
  ariaLabel,
  children,
  variant = "ghost",
  className,
  testId,
}: {
  href: string;
  ariaLabel: string;
  children: ReactNode;
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
  testId?: string;
}) {
  return (
    <Button variant={variant} size="sm" className={className} aria-label={ariaLabel} data-testid={testId} onPress={() => window.open(href, "_blank", "noopener,noreferrer")}>
      {children}
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
  /**
   * Either redirects (detail page → list, or back to the exact list page) or resolves with a
   * form state: its message becomes a toast while the current page refreshes in place – no
   * navigation, so the list keeps its scroll position and the page is not re-mounted.
   */
  action: (formData: FormData) => void | AdminFormState | Promise<void | AdminFormState>;
  id: string;
  returnTo?: string;
  title: string;
  description: string;
  label?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      if (returnTo) formData.set("return_to", returnTo);
      const result = await action(formData);
      if (result && typeof result === "object") {
        if (result.error) toast.error(result.error);
        else if (result.success) toast.success(result.success);
      }
      setOpen(false);
    });
  }

  return (
    <AlertDialogTrigger isOpen={open} onOpenChange={setOpen}>
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
  onChange,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  id?: string;
  /** Controlled use (e.g. Extra → Theme Customization keeps the state in React). */
  onChange?: (selected: boolean) => void;
}) {
  const autoId = useId();
  const inputId = id ?? `${name}-${autoId}`;
  const [selected, setSelected] = useSwitchValue(Boolean(defaultChecked));
  return (
    <FieldLabel htmlFor={inputId}>
      <Field orientation="horizontal">
        {onChange ? (
          <Checkbox
            id={inputId}
            isSelected={selected}
            onChange={(value) => {
              setSelected(value);
              onChange(value);
            }}
          />
        ) : (
          <Checkbox id={inputId} name={name} defaultSelected={defaultChecked} />
        )}
        <FieldContent>
          <FieldTitle>{label}</FieldTitle>
          {description && <FieldDescription>{description}</FieldDescription>}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

/**
 * Switch state for a form: a hidden input driven by React state (not the switch's own
 * checkbox), so what is shown is always what gets submitted. When the server value changes
 * underneath (saved elsewhere, page refreshed) the switch follows it.
 */
function useSwitchValue(defaultSelected: boolean) {
  const [selected, setSelected] = useState(defaultSelected);
  const [seenDefault, setSeenDefault] = useState(defaultSelected);
  if (seenDefault !== defaultSelected) {
    // derived-state reset during render (React-sanctioned pattern, no effect needed)
    setSeenDefault(defaultSelected);
    setSelected(defaultSelected);
  }
  return [selected, setSelected] as const;
}

/** Labelled switch (switch first, label text after it). */
export function SwitchField({ id, name, label, defaultSelected }: { id: string; name: string; label: ReactNode; defaultSelected: boolean }) {
  const [selected, setSelected] = useSwitchValue(defaultSelected);
  return (
    <FieldLabel htmlFor={id} className="items-center gap-3 py-1 text-sm font-medium has-data-selected:bg-transparent">
      <input type="hidden" name={name} value={selected ? "on" : "off"} />
      <Switch id={id} isSelected={selected} onChange={setSelected} />
      {label}
    </FieldLabel>
  );
}

/**
 * Settings-style row: title + one-line description on the left, the switch on the right.
 * `children` (e.g. an extra input) renders underneath, inside the same bordered row.
 */
export function SwitchRow({
  id,
  name,
  label,
  description,
  defaultSelected,
  children,
}: {
  id: string;
  name: string;
  label: string;
  description?: string;
  defaultSelected: boolean;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useSwitchValue(defaultSelected);
  return (
    // The label card keeps its hover / selected / focus styling; the border moves to the
    // wrapper so an extra field underneath sits inside the same box.
    <div className="rounded-md border" data-selected={selected || undefined} data-slot="switch-row">
      <FieldLabel htmlFor={id} className={cn("has-[>[data-slot=field]]:border-0", children && "has-[>[data-slot=field]]:rounded-b-none")}>
        <Field orientation="horizontal" className="items-center">
          <FieldContent>
            <FieldTitle>{label}</FieldTitle>
            {description && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
          <input type="hidden" name={name} value={selected ? "on" : "off"} />
          <Switch id={id} isSelected={selected} onChange={setSelected} />
        </Field>
      </FieldLabel>
      {children && <div className="border-t p-3">{children}</div>}
    </div>
  );
}
