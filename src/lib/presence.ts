/**
 * Presence rules shared by the server (API routes, pages) and the client (header
 * badge, heartbeat): who counts as online, what an admin's privacy switch shows
 * and how "Last seen …" is worded. Mirrors `presence_status()` / `store_presence()`
 * in supabase/migrations/20261031000000_presence.sql – keep the window in step.
 */

/** A heartbeat younger than this means "online" (the ping runs every 25 s). */
export const PRESENCE_ONLINE_WINDOW_MS = 45_000;

/** The interval the browser pings `/api/presence/ping` at. */
export const PRESENCE_PING_INTERVAL_MS = 25_000;

/**
 * No mouse, key, scroll or touch for this long and the visitor stops being "Online": the
 * heartbeat pauses on purpose, so the stamp ages out of the 45 s window and the other side
 * reads "Last seen …". A closed tab and a lost connection end the same way – "Online" is
 * never claimed on somebody's behalf, not even by a per-customer "Online" override.
 */
export const PRESENCE_IDLE_AFTER_MS = 120_000;

/** Admin privacy switch. `online` = show the real status, `last_seen_only` = never show "Online", `offline` = always offline. */
export const PRESENCE_VISIBILITIES = ["online", "last_seen_only", "offline"] as const;
export type PresenceVisibility = (typeof PRESENCE_VISIBILITIES)[number];

export function isPresenceVisibility(value: unknown): value is PresenceVisibility {
  return typeof value === "string" && (PRESENCE_VISIBILITIES as readonly string[]).includes(value);
}

export const PRESENCE_VISIBILITY_LABELS: Record<PresenceVisibility, string> = {
  online: "Online",
  last_seen_only: "Last seen only",
  offline: "Offline",
};

/** What the chat header needs to know about the other side. */
export type Presence = {
  online: boolean;
  /** ISO stamp, or null when the mode hides it (or the person was never seen). */
  lastActiveAt: string | null;
  /** Only set on the admin side – the customer's own mode is not configurable. */
  visibility?: PresenceVisibility;
};

/** Are these activity stamps inside the online window? */
export function presenceStatus(lastActiveAt: string | null | undefined, now: number = Date.now()): "online" | "offline" {
  if (!lastActiveAt) return "offline";
  const at = Date.parse(lastActiveAt);
  return Number.isFinite(at) && now - at <= PRESENCE_ONLINE_WINDOW_MS ? "online" : "offline";
}

export function isOnline(presence: Presence, now: number = Date.now()): boolean {
  return presence.online && presenceStatus(presence.lastActiveAt, now) === "online";
}

/**
 * The badge text: "Online", "Last seen 10:42 AM" or "Offline".
 * The time is formatted on the client (see `LocalTime`) – the server renders the
 * stable "Online" / "Offline" wording so hydration never has to guess a timezone.
 */
export function presenceLabel(presence: Presence, now: number = Date.now()): "Online" | "Offline" | "last_seen" {
  if (isOnline(presence, now)) return "Online";
  return presence.lastActiveAt ? "last_seen" : "Offline";
}

/** "Last seen 10:42 AM" – `time` comes from the caller so it can be locale aware. */
export function lastSeenLabel(time: string): string {
  return `Last seen ${time}`;
}
