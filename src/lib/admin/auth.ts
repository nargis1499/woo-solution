import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/types";

export const ADMIN_PATH = "/nemesis";

/**
 * Current user + admin flag, de-duplicated per request with React `cache()`
 * so the layout gate, the user menu and every data helper share one lookup.
 */
export const getAdminStatus = cache(async (): Promise<{ user: CurrentUser | null; isAdmin: boolean }> => {
  const user = await getCurrentUser();
  if (!user) return { user: null, isAdmin: false };

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  return { user, isAdmin: data?.is_admin === true };
});

export async function isCurrentUserAdmin(): Promise<boolean> {
  return (await getAdminStatus()).isAdmin;
}

/**
 * Page/layout guard: signed-out → login (and come back), signed-in non-admin →
 * 404 so the admin area doesn't even reveal that it exists.
 */
export async function requireAdmin(nextPath: string = ADMIN_PATH): Promise<CurrentUser> {
  const { user, isAdmin } = await getAdminStatus();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isAdmin) notFound();
  return user;
}

/** Server Action guard: throws instead of rendering, callers turn it into a form error. */
export async function assertAdmin(): Promise<CurrentUser> {
  const { user, isAdmin } = await getAdminStatus();
  if (!user || !isAdmin) throw new AdminAuthError();
  return user;
}

export class AdminAuthError extends Error {
  constructor() {
    super("You need to be an admin to do that.");
    this.name = "AdminAuthError";
  }
}
