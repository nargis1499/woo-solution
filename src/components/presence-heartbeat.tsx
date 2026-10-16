"use client";

import { useEffect, useRef } from "react";
import { PRESENCE_PING_INTERVAL_MS } from "@/lib/presence";

/**
 * Keeps the signed-in visitor's `profiles.last_active_at` fresh so the other side of
 * an order inquiry sees "Online" instead of a stale stamp.
 *
 *  * pings immediately, then every 25 s (well inside the 45 s online window);
 *  * pings again the moment the tab becomes visible – a tab that was asleep in the
 *    background should not look offline while you are reading it;
 *  * stops for good after a 401 (signed-out visitors are simply not tracked);
 *  * `keepalive` so a ping survives a navigation that happens mid-request.
 *
 * Rendered for signed-in users only (see <PresenceGate>).
 */
export function PresenceHeartbeat() {
  const stop = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = async () => {
      if (stop.current) return;
      try {
        const response = await fetch("/api/presence/ping", { method: "POST", keepalive: true, cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          stop.current = true;
          if (timer) clearInterval(timer);
        }
      } catch {
        // offline / server restart: the next tick tries again
      }
    };

    void ping();
    timer = setInterval(ping, PRESENCE_PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
