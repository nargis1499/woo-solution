"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";

type Placement = "top-right" | "bottom-right";

/*
 * Where toasts show up is decided by the layout that is currently on screen, not by the
 * URL: `usePathname()` / `useSelectedLayoutSegment()` count as "URL data" under Cache
 * Components and would force the toaster behind a Suspense boundary – and sonner only
 * shows toasts fired *after* its outlet has mounted, so a late-mounting outlet could miss
 * the "saved" toast a redirect lands with. A tiny external store avoids both problems.
 */
const DEFAULT: Placement = "top-right";
let placement: Placement = DEFAULT;
const listeners = new Set<() => void>();
function setPlacement(next: Placement) {
  if (placement === next) return;
  placement = next;
  listeners.forEach((notify) => notify());
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => void listeners.delete(notify);
}
const getPlacement = () => placement;
const getServerPlacement = () => DEFAULT;

/**
 * The single toast outlet for the whole app, mounted once in the root layout
 * (`toast()` from anywhere lands here). Storefront: top-right, pushed below the
 * sticky header. Admin dashboard: bottom-right (see `<ToastPlacement>` in its layout).
 */
export function AppToaster() {
  const position = useSyncExternalStore(subscribe, getPlacement, getServerPlacement);
  const bottom = position === "bottom-right";
  return (
    <Toaster
      position={position}
      offset={bottom ? { bottom: 24, right: 24 } : { top: 80 }}
      mobileOffset={bottom ? { bottom: 16 } : { top: 72 }}
      richColors
      closeButton
      duration={4500}
      visibleToasts={4}
    />
  );
}

/** Render inside a layout to move the app's toasts while that layout is on screen. */
export function ToastPlacement({ position }: { position: Placement }) {
  useEffect(() => {
    setPlacement(position);
    return () => setPlacement(DEFAULT);
  }, [position]);
  return null;
}
