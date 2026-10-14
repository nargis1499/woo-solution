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
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    if (!notice && !error) return;
    const key = `${pathname}|${notice ?? ""}|${error ?? ""}`;
    if (lastShown.current === key) return; // React Strict Mode re-runs effects
    lastShown.current = key;

    if (error) toast.error(error);
    else if (notice) toast.success(notice);

    // Strip the one-shot params without a server round-trip.
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
  useEffect(() => {
    if (!state) return;
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);
}
