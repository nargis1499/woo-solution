"use client";

import { useEffect, useRef } from "react";
import { PRESENCE_IDLE_AFTER_MS, PRESENCE_PING_INTERVAL_MS } from "@/lib/presence";

/**
 * Keeps the signed-in visitor's `profiles.last_active_at` fresh so the other side of
 * an order inquiry sees "Online" instead of a stale stamp.
 *
 *  * pings immediately, then every 25 s (well inside the 45 s online window);
 *  * **idle means away**: after PRESENCE_IDLE_AFTER_MS without a mouse, key, scroll or
 *    touch the pings stop on purpose, so the stamp ages out of the window and the other
 *    side reads "Last seen …". A closed tab or a lost connection ends the same way – an
 *    "Online" that somebody forced on their own profile must still mean a person who is
 *    really there, never a browser left open on a desk;
 *  * the first sign of life pings again at once, so sitting back down shows up in a
 *    second instead of waiting for the next tick;
 *  * pings again the moment the tab becomes visible;
 *  * stops for good after a 401 (signed-out visitors are simply not tracked);
 *  * `keepalive` so a ping survives a navigation that happens mid-request.
 *
 * Rendered for signed-in users only (see <PresenceGate>).
 */
export function PresenceHeartbeat() {
  const stop = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    /** Last sign of life. Starts at mount, so a page nobody touches goes idle like any other. */
    let lastActive = Date.now();

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

    /** Interval tick: only beats while somebody is actually at the keyboard. */
    const beat = () => {
      if (stop.current) return;
      if (Date.now() - lastActive >= PRESENCE_IDLE_AFTER_MS) return; // let the stamp age out
      void ping();
    };

    const onActivity = () => {
      const now = Date.now();
      const idle = now - lastActive >= PRESENCE_IDLE_AFTER_MS;
      if (!idle && now - lastActive < ACTIVITY_THROTTLE_MS) return; // a moving mouse is not a thousand updates a second
      lastActive = now;
      if (idle) void ping(); // back at the keyboard: say so immediately
    };

    void ping();
    timer = setInterval(beat, PRESENCE_PING_INTERVAL_MS);
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastActive = Date.now();
      void ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}

/** Signs of life that reset the idle clock – one update every 5 s is plenty. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;
const ACTIVITY_THROTTLE_MS = 5_000;
