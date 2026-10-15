"use client";

import { useEffect } from "react";

const MESSAGE = "You have unsaved changes. Leave this page anyway?";

/**
 * Warns before the edits in a form are lost: the browser's own prompt for
 * reloads / closed tabs, and a confirm() for in-app links (the App Router has
 * no navigation blocking API, so link clicks are intercepted while capturing).
 * Links that open a new tab, download or use modifier keys are left alone.
 */
export function useUnsavedChanges(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = MESSAGE; // legacy browsers need a value
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href.startsWith("javascript:")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // hash / same page
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled]);
}
