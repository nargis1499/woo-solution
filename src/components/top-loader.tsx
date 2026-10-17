"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeCustomization } from "@/components/theme/theme-customization";

/**
 * Slim progress bar at the very top of the page while navigating between
 * routes (like YouTube / GitHub). No dependencies:
 *  - starts when a same-origin link is clicked or the user goes back/forward,
 *  - trickles towards 90 % while the new route streams in,
 *  - completes as soon as the pathname/search params change.
 */
export function TopLoader() {
  const { gradients } = useThemeCustomization();
  // Gradients are per mode: follow whichever palette the page is currently rendered in.
  const { resolvedTheme } = useTheme();
  const gradientBar = gradients[resolvedTheme === "dark" ? "dark" : "light"].loader.enabled;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const active = useRef(false);
  const timers = useRef<{ trickle?: ReturnType<typeof setInterval>; hide?: ReturnType<typeof setTimeout>; safety?: ReturnType<typeof setTimeout> }>({});

  const clear = () => {
    clearInterval(timers.current.trickle);
    clearTimeout(timers.current.hide);
    clearTimeout(timers.current.safety);
  };

  const finish = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clear();
    setProgress(100);
    timers.current.hide = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
  }, []);

  const start = useCallback(() => {
    clear();
    active.current = true;
    setVisible(true);
    setProgress(10);
    timers.current.trickle = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.12 + 0.5));
    }, 200);
    // never leave a stuck bar behind (e.g. the navigation was aborted)
    timers.current.safety = setTimeout(finish, 12000);
  }, [finish]);

  // Route changed → done.
  const routeKey = `${pathname}?${searchParams.toString()}`;
  useEffect(() => {
    finish();
  }, [routeKey, finish]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // hash / same page
      start();
    };
    const onPopState = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      clear();
    };
  }, [start]);

  return (
    <div data-top-loader className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5" aria-hidden>
      {/* colour / gradient come from Extra → Theme Customization */}
      <div
        className="theme-loader h-full bg-[var(--loader)] shadow-[0_0_8px_var(--loader)] transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${progress}%`, opacity: visible ? 1 : 0, backgroundImage: gradientBar ? "var(--loader-image)" : undefined }}
        data-gradient={gradientBar ? "1" : undefined}
      />
    </div>
  );
}
