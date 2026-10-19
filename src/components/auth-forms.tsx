"use client";

import Link from "next/link";
import { useActionState, useState, type ComponentProps } from "react";
import { CircleCheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { signIn, signUp, type AuthFormState } from "@/app/auth/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GoogleSignInButton, OrDivider } from "./google-button";

const initial: AuthFormState = {};

function PasswordInput({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        data-testid="password-visibility-toggle"
        className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden />
        ) : (
          <EyeIcon className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  const message = state.error ?? error;

  return (
    <div className="space-y-5">
      <GoogleSignInButton next={next} />
      <OrDivider />
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <FieldGroup className="gap-5">
          {message && (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="email">E-mail address</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" isPending={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <FieldDescription className="text-center">
            New customer?{" "}
            <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUp, initial);

  if (state.message) {
    return (
      <div className="space-y-4">
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <LinkButton href={`/login?next=${encodeURIComponent(next)}`} variant="outline" className="w-full">
          Go to sign in
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GoogleSignInButton next={next} label="Sign up with Google" />
      <OrDivider />
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <FieldGroup className="gap-5">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="full_name">Full name</FieldLabel>
            <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={state.values?.full_name ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">E-mail address</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={6} required />
            <FieldDescription>At least 6 characters.</FieldDescription>
          </Field>
          <Button type="submit" size="lg" className="w-full" isPending={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <FieldDescription className="text-center">
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
