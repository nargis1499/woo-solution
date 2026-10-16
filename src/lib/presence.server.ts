import "server-only";
import { createClient } from "@/lib/supabase/server";
import { presenceStatus, type Presence, type PresenceVisibility } from "@/lib/presence";

/**
 * Reads of the presence columns (migration 18).
 *
 *  * `getStorePresence()` – the customer's view of the store's support team. It calls
 *    the `store_presence()` SQL function, which already applies the admin's privacy
 *    mode *in the database*, so a hidden activity time never reaches the browser.
 *  * `getPersonPresence()` – the admin's view of one customer (profiles are readable
 *    by admins, and a customer's own row by themselves).
 */

export type StorePresence = Presence & { name: string | null; avatarUrl: string | null };

const rowPresence = (lastActiveAt: string | null, online: boolean): Presence => ({
  online: online && presenceStatus(lastActiveAt) === "online",
  lastActiveAt: lastActiveAt ?? null,
});

/** What a customer may know about the store admin – filtered by the admin's own mode. */
export async function getStorePresence(): Promise<StorePresence> {
  const empty: StorePresence = { online: false, lastActiveAt: null, name: null, avatarUrl: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("store_presence").maybeSingle();
  if (error || !data) return empty;

  const row = data as { online: boolean | null; last_active_at: string | null; visibility: string | null; full_name: string | null; avatar_url: string | null };
  return {
    ...rowPresence(row.last_active_at, row.online === true),
    visibility: (row.visibility as PresenceVisibility | null) ?? "online",
    name: row.full_name,
    avatarUrl: row.avatar_url,
  };
}

/** The presence of one customer, as any admin sees it (no privacy switch on their side). */
export async function getPersonPresence(userId: string): Promise<Presence & { name: string | null; avatarUrl: string | null }> {
  const empty = { online: false, lastActiveAt: null as string | null, name: null as string | null, avatarUrl: null as string | null };
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("full_name, avatar_url, last_active_at").eq("id", userId).maybeSingle();
  if (error || !data) return empty;

  const row = data as { full_name: string | null; avatar_url: string | null; last_active_at: string | null };
  return { ...rowPresence(row.last_active_at, presenceStatus(row.last_active_at) === "online"), name: row.full_name, avatarUrl: row.avatar_url };
}

/** The signed-in admin's own privacy switch (`online` when the column is missing). */
export async function getPresenceVisibility(userId: string): Promise<PresenceVisibility> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("presence_visibility").eq("id", userId).maybeSingle();
  if (error || !data) return "online";
  const value = (data as { presence_visibility: string | null }).presence_visibility;
  return value === "last_seen_only" || value === "offline" ? value : "online";
}

/** Author of the admin bubbles: the admin in charge of this thread (the freshest one). */
export async function getStoreIdentity(): Promise<{ name: string; avatarUrl: string | null }> {
  const presence = await getStorePresence();
  return { name: presence.name ?? "Store Admin", avatarUrl: presence.avatarUrl };
}
