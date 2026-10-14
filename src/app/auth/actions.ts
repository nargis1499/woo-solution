"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  message?: string;
  /** Echoed back so the form keeps what the user typed after a failed attempt. */
  values?: { email?: string; full_name?: string };
};

/** Only allow same-site relative redirects (prevents open-redirects). */
function safeNext(value: FormDataEntryValue | null, fallback = "/"): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const values = { email };
  if (!email || !password) return { error: "Please enter your e-mail and password.", values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message, values };

  redirect(next);
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const values = { email, full_name: fullName };
  if (!fullName) return { error: "Please tell us your name.", values };
  if (!email) return { error: "Please enter your e-mail address.", values };
  if (password.length < 6) return { error: "Password must be at least 6 characters.", values };

  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message, values };

  // "Confirm email" enabled in Supabase → no session until the link is clicked.
  if (!data.session) {
    return {
      message: `We've sent a confirmation link to ${email}. Click it to activate your account, then sign in.`,
    };
  }

  redirect(next);
}

/**
 * Starts the Google OAuth (PKCE) flow. Supabase returns the Google consent URL;
 * the code verifier is stored in a cookie and `/auth/callback` finishes the
 * exchange. Requires the Google provider to be enabled in the Supabase dashboard.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    const message = error?.message ?? "Could not start Google sign-in.";
    redirect(`/login?error=oauth&message=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
