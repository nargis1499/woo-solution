"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { AdminFormState } from "@/app/nemesis/actions";

/**
 * Turns the `?notice=` / `?error=` query params that redirecting admin actions
 * (create, delete, toggle …) land on into a toast, then removes them from the
 * URL so a refresh or a shared link doesn't repeat the message.
 */
export function FlashToast() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notice = searchParams.get("notice");
  const error = searchParams.get("error");
  const lastShown = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!notice && !error) return;

    // Show each message once, even when the same flash travels through a redirect
    // chain (e.g. "deleted" on a page that no longer exists → last valid page) or
    // when Strict Mode re-runs the effect.
    const key = `${pathname}|${notice ?? ""}|${error ?? ""}`;
    const repeat = lastShown.current?.key === key && Date.now() - lastShown.current.at < 3000;
    if (!repeat) {
      lastShown.current = { key, at: Date.now() };
      if (error) toast.error(error);
      else if (notice) toast.success(notice);
    }

    // Always strip the one-shot params (no server round-trip) so a refresh or a
    // shared link doesn't repeat the message.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("notice");
    params.delete("error");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams, notice, error]);

  return null;
}

/**
 * Reports the outcome of a `useActionState` form (update order, save user,
 * settings …) as a toast. Field-level validation errors stay next to their
 * inputs; only the overall success / error message moves to the toast.
 */
export function useFormToast(state: AdminFormState) {
  // Next.js keeps visited pages mounted but hidden (<Activity>) and re-runs their effects when you
  // navigate back – with the same `state` still in place. Remember which result was already reported
  // so a toast is shown exactly once, right after the action it belongs to.
  const reported = useRef<AdminFormState>(null);
  useEffect(() => {
    if (!state || reported.current === state) return;
    reported.current = state;
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);
}
