"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, PlusIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { createUser } from "@/app/nemesis/actions";
import type { AdminFormState } from "@/lib/admin/form";
import { PASSWORD_MIN, generatePassword, passwordStrength } from "@/lib/password";
import { useFormToast } from "@/components/admin/flash-toast";
import { SubmitButton } from "@/components/admin/form-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * "New user" on the dashboard Users page: an account (name, e-mail, phone, role, password)
 * created in a modal. The password field can generate a strong one, reveal it and copy it,
 * and the dialog mounts its form fresh on every open so old validation never lingers.
 */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false);

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button data-testid="create-user-trigger">
        <PlusIcon />
        New user
      </Button>
      {open && <CreateUserForm onDone={() => setOpen(false)} />}
    </DialogTrigger>
  );
}

const STRENGTH_STYLES = ["bg-muted", "bg-destructive", "bg-amber-500", "bg-emerald-500", "bg-emerald-500"] as const;
const STRENGTH_TEXT = ["", "text-destructive", "text-amber-600 dark:text-amber-500", "text-emerald-600", "text-emerald-600"] as const;

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(createUser, null);
  useFormToast(state);

  const [password, setPassword] = useState(() => generatePassword());
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // A successful create: close the dialog and let the list re-render with the new row.
  useEffect(() => {
    if (!state?.success) return;
    onDone();
    router.refresh();
  }, [state, onDone, router]);

  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const strength = passwordStrength(password);

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Password copied.");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure context, denied permission) – the field
      // is visible, so the admin can still select and copy it by hand.
      toast.error("The browser would not let the page copy it. Select the password and copy it manually.");
    }
  }

  function generate() {
    setPassword(generatePassword());
    setRevealed(true);
  }

  return (
    <Dialog isDismissable={!pending} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <form action={formAction} className="space-y-4" noValidate data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>

        <Field data-invalid={Boolean(err.full_name) || undefined}>
          <FieldLabel htmlFor="new-user-name">Full name</FieldLabel>
          <Input
            id="new-user-name"
            name="full_name"
            maxLength={120}
            required
            autoComplete="off"
            defaultValue={v.full_name ?? ""}
            aria-invalid={Boolean(err.full_name) || undefined}
            data-testid="create-user-name"
            autoFocus
          />
          <FieldError>{err.full_name}</FieldError>
        </Field>

        <Field data-invalid={Boolean(err.email) || undefined}>
          <FieldLabel htmlFor="new-user-email">E-mail</FieldLabel>
          <Input
            id="new-user-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            required
            defaultValue={v.email ?? ""}
            aria-invalid={Boolean(err.email) || undefined}
            data-testid="create-user-email"
          />
          <FieldError>{err.email}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="new-user-phone">Phone</FieldLabel>
            <Input id="new-user-phone" name="phone" type="tel" inputMode="tel" maxLength={40} autoComplete="off" defaultValue={v.phone ?? ""} data-testid="create-user-phone" />
          </Field>

          <Field>
            <FieldLabel htmlFor="new-user-role">Role</FieldLabel>
            <Select name="role" defaultSelectedKey={v.role === "admin" ? "admin" : "customer"} aria-label="Role">
              <SelectTrigger id="new-user-role" className="w-full" data-testid="create-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="customer">Customer</SelectItem>
                <SelectItem id="admin">Administrator</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field data-invalid={Boolean(err.password) || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="new-user-password">Password</FieldLabel>
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onPress={generate} data-testid="create-user-generate">
              <WandSparklesIcon />
              Generate
            </Button>
          </div>
          <div className="relative">
            <Input
              id="new-user-password"
              name="password"
              type={revealed ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              required
              minLength={PASSWORD_MIN}
              aria-invalid={Boolean(err.password) || undefined}
              className="pr-[4.25rem] font-mono"
              data-testid="create-user-password"
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={revealed ? "Hide password" : "Show password"}
                aria-pressed={revealed}
                onPress={() => setRevealed((value) => !value)}
                data-testid="create-user-reveal"
              >
                {revealed ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Copy password"
                isDisabled={!password}
                onPress={() => void copyPassword()}
                data-testid="create-user-copy"
              >
                {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
              </Button>
            </div>
          </div>
          {password && (
            <div className="flex items-center gap-2" data-testid="create-user-strength" data-score={strength.score}>
              <div className="flex h-1 flex-1 gap-1" aria-hidden>
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={cn("h-full flex-1 rounded-full transition-colors", step <= strength.score ? STRENGTH_STYLES[strength.score] : "bg-muted")} />
                ))}
              </div>
              <span className={cn("w-12 text-right text-xs font-medium", STRENGTH_TEXT[strength.score])}>{strength.label}</span>
            </div>
          )}
          <FieldError>{err.password}</FieldError>
        </Field>

        <DialogFooter>
          <DialogClose isDisabled={pending}>Cancel</DialogClose>
          <SubmitButton pending={pending} pendingLabel="Creating…" data-testid="create-user-submit">
            Create user
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
