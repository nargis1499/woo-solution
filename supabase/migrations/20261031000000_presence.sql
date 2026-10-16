-- -----------------------------------------------------------------------------
--  PRESENCE & RECEIPTS — who is online, and when a message was seen
--
--  * `profiles.last_active_at` is the single source of truth: the browser pings
--    /api/presence/ping every 25 s and the timestamp is stamped here. Being
--    "online" is derived from it (≤ 45 s old) instead of storing a flag that
--    would go stale the moment a tab is closed – see the `presence_status()`
--    helper below and PRESENCE_ONLINE_WINDOW_MS in src/lib/presence.ts.
--  * `profiles.presence_visibility` is the **admin-only** privacy switch:
--      online         – customers see "Online" while they are active
--      last_seen_only – customers never see "Online", only "Last seen …"
--      offline        – customers always see "Offline" (no time at all)
--    `store_presence()` applies that filter *inside the database*, so the raw
--    activity time of an admin who hides it never leaves the server.
--  * `order_messages.delivered_at` / `seen_at` are the read receipts behind the
--    ✓ / ✓✓ marks: the recipient stamps them, the PostgREST broadcast tells the
--    sender's open tab (see src/app/api/orders/[id]/chat/stream).
-- -----------------------------------------------------------------------------

-- 1. presence columns ---------------------------------------------------------
alter table public.profiles add column if not exists last_active_at timestamptz;
alter table public.profiles add column if not exists presence_visibility text not null default 'online';

do $$
begin
  alter table public.profiles add constraint profiles_presence_visibility_check
    check (presence_visibility in ('online', 'last_seen_only', 'offline'));
exception
  when duplicate_object then null;
end $$;

create index if not exists profiles_last_active_idx on public.profiles (last_active_at desc nulls last);
-- the store's presence reads the freshest admin only
create index if not exists profiles_admins_active_idx on public.profiles (last_active_at desc nulls last) where is_admin;

-- 2. read receipts ------------------------------------------------------------
alter table public.order_messages add column if not exists delivered_at timestamptz;
alter table public.order_messages add column if not exists seen_at timestamptz;

create index if not exists order_messages_unseen_idx on public.order_messages (order_id) where seen_at is null;

-- 3. helpers ------------------------------------------------------------------

/**
 * ONLINE / OFFLINE of one activity stamp. Mirrored by `presenceStatus()` in
 * src/lib/presence.ts – keep the 45 seconds in step with PRESENCE_ONLINE_WINDOW_MS.
 */
create or replace function public.presence_status(p_last_active_at timestamptz, p_now timestamptz default now())
returns text
language sql
immutable
as $$
  select case
    when p_last_active_at is null then 'offline'
    when p_last_active_at > p_now - interval '45 seconds' then 'online'
    else 'offline'
  end;
$$;

/**
 * What a **customer** is allowed to know about the store's support team: the
 * most recently active admin, already filtered by that admin's visibility mode.
 *
 *   online          → online + the real timestamp
 *   last_seen_only  → never online, timestamp kept ("Last seen 10:42 AM")
 *   offline         → never online, timestamp removed entirely
 *
 * `security definer` because customers cannot read other profiles; the function
 * is the only door and it never exposes more than the mode allows.
 */
create or replace function public.store_presence()
returns table (online boolean, last_active_at timestamptz, visibility text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  with admin_row as (
    select p.full_name, p.avatar_url, p.last_active_at, p.presence_visibility
    from public.profiles p
    where p.is_admin
    order by p.last_active_at desc nulls last
    limit 1
  )
  select
    case when a.presence_visibility = 'online'
         then public.presence_status(a.last_active_at) = 'online'
         else false
    end as online,
    case when a.presence_visibility = 'offline' then null else a.last_active_at end as last_active_at,
    coalesce(a.presence_visibility, 'online') as visibility,
    a.full_name,
    a.avatar_url
  from admin_row a;
$$;

revoke all on function public.store_presence() from public;
grant execute on function public.store_presence() to anon, authenticated, service_role;

-- 4. keep the presence columns out of the customers' hands ---------------------
-- `presence_visibility` is only ever read for admins, and `last_active_at` is
-- written by the owner through the existing "own profile" policy – nothing extra
-- is granted here. Customers never receive an admin's raw stamp: the only path
-- to it is `store_presence()` above.
comment on column public.profiles.presence_visibility is 'Admin-only privacy switch: online | last_seen_only | offline (see public.store_presence())';
comment on column public.profiles.last_active_at is 'Last heartbeat from /api/presence/ping; online = newer than 45 s';
