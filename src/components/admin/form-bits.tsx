"use client";

import { useId, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronDownIcon, StarIcon, Trash2Icon, ZapIcon } from "lucide-react";
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
 * One-click star toggle for marking/unmarking a product as Featured directly from the
 * Products table. Uses a React Aria `Button` so pressing it inside a linked DataGrid row
 * toggles the star without navigating to the row's edit page.
 */
export function FeaturedToggleButton({
  id,
  name,
  initialFeatured,
  action,
}: {
  id: string;
  name: string;
  initialFeatured: boolean;
  action: (id: string, featured: boolean) => Promise<{ ok: boolean; is_featured?: boolean; message?: string; error?: string }>;
}) {
  const router = useRouter();
  const [featured, setFeatured] = useSwitchValue(initialFeatured);
  const [pending, startTransition] = useTransition();
  const label = featured ? `Remove "${name}" from featured` : `Mark "${name}" as featured`;

  function toggle() {
    if (pending) return;
    const next = !featured;
    setFeatured(next);
    startTransition(async () => {
      const result = await action(id, next);
      if (!result.ok) {
        setFeatured(!next);
        toast.error(result.error ?? "Could not update featured status.");
        return;
      }
      setFeatured(Boolean(result.is_featured));
      if (result.message) toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      isDisabled={pending}
      aria-label={label}
      aria-pressed={featured}
      data-testid="product-featured-toggle"
      data-product-id={id}
      data-featured={featured ? "true" : "false"}
      onPress={toggle}
      className={cn(
        "rounded-full transition-colors",
        featured
          ? "text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          : "text-muted-foreground/45 hover:bg-muted hover:text-amber-400",
      )}
    >
      <StarIcon className={cn("size-4 transition-transform", featured && "fill-current scale-105")} />
    </Button>
  );
}

/**
 * One-click lightning toggle for enabling/disabling Quick Checkout on a product directly
 * from the Products table. Disabled by default for new products.
 */
export function QuickCheckoutToggleButton({
  id,
  name,
  initialEnabled,
  action,
}: {
  id: string;
  name: string;
  initialEnabled: boolean;
  action: (
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean; quick_checkout?: boolean; message?: string; error?: string }>;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useSwitchValue(initialEnabled);
  const [pending, startTransition] = useTransition();
  const label = enabled
    ? `Disable Quick Checkout for "${name}"`
    : `Enable Quick Checkout for "${name}"`;

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await action(id, next);
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error ?? "Could not update Quick Checkout.");
        return;
      }
      setEnabled(Boolean(result.quick_checkout));
      if (result.message) toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      isDisabled={pending}
      aria-label={label}
      aria-pressed={enabled}
      data-testid="product-quick-checkout-toggle"
      data-product-id={id}
      data-quick-checkout={enabled ? "true" : "false"}
      onPress={toggle}
      className={cn(
        "rounded-full transition-colors",
        enabled
          ? "bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary"
          : "text-muted-foreground/45 hover:bg-muted hover:text-primary",
      )}
    >
      <ZapIcon className={cn("size-4 transition-transform", enabled && "fill-current scale-105")} />
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

/**
 * "Delete all" – the destructive button that wipes the whole list. Same confirmation
 * pattern as DeleteButton, but the action receives only `return_to`; the server decides
 * what "all" means (so it also works from page 3).
 */
export function DeleteAllButton({
  action,
  returnTo,
  title,
  description,
  label,
  count,
  testId = "delete-all",
}: {
  action: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
  title: string;
  description: string;
  label: string;
  /** Disabled when the list is already empty. */
  count: number;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const formData = new FormData();
      if (returnTo) formData.set("return_to", returnTo);
      await action(formData);
      setOpen(false);
    });
  }

  return (
    <AlertDialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" aria-label={label} isDisabled={count === 0} data-testid={`${testId}-trigger`}>
        <Trash2Icon /> {label}
      </Button>
      <AlertDialog isDismissable={!pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel isDisabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onPress={confirm} isPending={pending} aria-busy={pending} data-testid={`${testId}-confirm`}>
            {pending && <Spinner />}
            {pending ? "Deleting…" : "Delete all"}
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
 * When `children` is present, the row is collapsible (collapsed by default) and expands smoothly.
 */
export function SwitchRow({
  id,
  name,
  label,
  description,
  defaultSelected,
  defaultOpen = false,
  children,
}: {
  id: string;
  name: string;
  label: string;
  description?: string;
  defaultSelected: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useSwitchValue(defaultSelected);
  const [open, setOpen] = useState(defaultOpen);

  if (!children) {
    return (
      <div
        className="rounded-md border"
        data-selected={selected || undefined}
        data-slot="switch-row"
      >
        <FieldLabel htmlFor={id} className="has-[>[data-slot=field]]:border-0">
          <Field orientation="horizontal" className="items-center">
            <FieldContent>
              <FieldTitle>{label}</FieldTitle>
              {description && <FieldDescription>{description}</FieldDescription>}
            </FieldContent>
            <input type="hidden" name={name} value={selected ? "on" : "off"} />
            <Switch id={id} isSelected={selected} onChange={setSelected} />
          </Field>
        </FieldLabel>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border transition-colors",
        selected && "border-primary/35 bg-primary/[0.04]",
      )}
      data-selected={selected || undefined}
      data-open={open || undefined}
      data-slot="switch-row"
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid={`switch-row-collapse-${id}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <FieldContent>
            <FieldTitle>{label}</FieldTitle>
            {description && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center pl-1">
          <input type="hidden" name={name} value={selected ? "on" : "off"} />
          <Switch
            id={id}
            aria-label={label}
            isSelected={selected}
            onChange={setSelected}
          />
        </div>
      </div>

      <div
        aria-hidden={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
