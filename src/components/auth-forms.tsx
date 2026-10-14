"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/auth/actions";
import { Button } from "./ui/button";
import { FormError, FormSuccess, Input, Label } from "./ui/field";
import { GoogleSignInButton, OrDivider } from "./google-button";

const initial: AuthFormState = {};

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <div className="space-y-5">
      <GoogleSignInButton next={next} />
      <OrDivider />
      <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error ?? error} />
      <div>
        <Label htmlFor="email" required>E-mail address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} />
      </div>
      <div>
        <Label htmlFor="password" required>Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-neutral-600">
        New customer?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">
          Create an account
        </Link>
      </p>
      </form>
    </div>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUp, initial);

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormSuccess message={state.message} />
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="block text-center text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GoogleSignInButton next={next} label="Sign up with Google" />
      <OrDivider />
      <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error} />
      <div>
        <Label htmlFor="full_name" required>Full name</Label>
        <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={state.values?.full_name ?? ""} />
      </div>
      <div>
        <Label htmlFor="email" required>E-mail address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} />
      </div>
      <div>
        <Label htmlFor="password" required>Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required />
        <p className="mt-1 text-xs text-neutral-500">At least 6 characters.</p>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-neutral-600">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">
          Sign in
        </Link>
      </p>
      </form>
    </div>
  );
}
