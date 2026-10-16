-- -----------------------------------------------------------------------------
--  PER-CUSTOMER ADMIN VISIBILITY — who sees the store as "Online"
--
--  Migration 18 gave the admin one *global* privacy switch
--  (`profiles.presence_visibility`). This migration adds the granular layer:
--  a row per (admin, customer) pair in `admin_customer_visibility`.
--
--    online          → that customer sees "Online" *while the admin is really there*,
--                      and "Last seen …" the moment they are not. "Online" is never
--                      claimed on the admin's behalf: a closed tab, a lost connection
--                      or a computer left idle (the heartbeat pauses, see
--                      PRESENCE_IDLE_AFTER_MS) all end in "Last seen …"
--    last_seen_only  → that customer never sees "Online", only "Last seen …"
--    offline         → that customer always sees "Offline" (no time at all)
--
--  A row is materialised **the moment a customer places an order** (trigger
--  below) with the default `last_seen_only`, so by default nobody sees the
--  admin online. When no row exists at all (a customer with no order yet, a
--  guest order, an older account) the admin's global switch decides — that is
--  the fallback `store_presence_for()` implements with `coalesce`.
--
--  Read path: customers call `store_presence_for(auth.uid())`, which applies
--  the override *inside the database*; admins read the table directly through
--  the RLS policies below. The customer-facing read of a message's "seen" state
--  (see `customerVisibleReceipt()` in src/lib/order-chat.ts) uses the same
--  resolved visibility, but only for what the browser *paints*: the stored
--  receipts stay untouched, so the admin's own thread keeps the real ones.
-- -----------------------------------------------------------------------------

-- 1. the override table -------------------------------------------------------
create table if not exists public.admin_customer_visibility (
  admin_id uuid not null references public.profiles (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  visibility text not null default 'last_seen_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (admin_id, customer_id)
);

do $$
begin
  alter table public.admin_customer_visibility add constraint admin_customer_visibility_check
    check (visibility in ('online', 'last_seen_only', 'offline'));
exception
  when duplicate_object then null;
end $$;

create index if not exists admin_customer_visibility_customer_idx on public.admin_customer_visibility (customer_id);

comment on table public.admin_customer_visibility is 'Per-customer override of an admin''s presence visibility; a row is seeded with ''last_seen_only'' when the customer orders';
comment on column public.admin_customer_visibility.visibility is 'online | last_seen_only | offline – what *this* customer may see';

-- 2. RLS: only the admin the row belongs to ------------------------------------
-- Customers never read the table: the only path to a resolved value for them is
-- store_presence_for(), which returns just what the mode allows.
alter table public.admin_customer_visibility enable row level security;

drop policy if exists "Admins read their own customer visibility" on public.admin_customer_visibility;
create policy "Admins read their own customer visibility"
  on public.admin_customer_visibility for select to authenticated
  using (admin_id = auth.uid() and public.is_admin());

drop policy if exists "Admins set their own customer visibility" on public.admin_customer_visibility;
create policy "Admins set their own customer visibility"
  on public.admin_customer_visibility for insert to authenticated
  with check (admin_id = auth.uid() and public.is_admin());

drop policy if exists "Admins update their own customer visibility" on public.admin_customer_visibility;
create policy "Admins update their own customer visibility"
  on public.admin_customer_visibility for update to authenticated
  using (admin_id = auth.uid() and public.is_admin())
  with check (admin_id = auth.uid() and public.is_admin());
-- no delete policy: a row is the admin's decision about a customer, not a cache entry

-- 3. default on a new order ---------------------------------------------------
-- The first order of a customer is when the thread (and therefore the privacy
-- question) starts, so that is where the default row is written.
create or replace function public.orders_seed_admin_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    insert into public.admin_customer_visibility (admin_id, customer_id, visibility)
    select p.id, new.user_id, 'last_seen_only'
    from public.profiles p
    where p.is_admin
    on conflict (admin_id, customer_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists orders_seed_admin_visibility on public.orders;
create trigger orders_seed_admin_visibility
  after insert on public.orders
  for each row execute function public.orders_seed_admin_visibility();

-- 4. backfill the customers that already ordered -------------------------------
insert into public.admin_customer_visibility (admin_id, customer_id, visibility)
select a.id, c.customer_id, 'last_seen_only'
from (select id from public.profiles where is_admin) a
cross join (select distinct o.user_id as customer_id from public.orders o where o.user_id is not null) c
on conflict (admin_id, customer_id) do nothing;

-- 5. resolving the effective visibility ---------------------------------------
/**
 * What **one customer** is allowed to know about the store's support team: the
 * most recently active admin, filtered by the visibility that applies to them –
 * their explicit override first, the admin's global switch as the fallback.
 *
 *   online          → online only while the heartbeat is fresh (≤ 45 s), timestamp kept
 *                     so an idle, closed or disconnected admin shows "Last seen 10:42 AM"
 *   last_seen_only  → never online, timestamp kept ("Last seen 10:42 AM")
 *   offline         → never online, timestamp removed entirely
 *
 * A caller may only ask about their own override; admins may ask for anyone.
 * Guests (p_customer null / no session) fall back to the global switch, which is
 * exactly what `store_presence()` already returned.
 */
create or replace function public.store_presence_for(p_customer uuid)
returns table (online boolean, last_active_at timestamptz, visibility text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  with admin_row as (
    select
      p.full_name,
      p.avatar_url,
      p.last_active_at,
      coalesce(cv.visibility, p.presence_visibility, 'online') as mode
    from public.profiles p
    left join public.admin_customer_visibility cv
      on cv.admin_id = p.id
     and cv.customer_id = p_customer
     and (public.is_admin() or p_customer = auth.uid())
    where p.is_admin
    order by p.last_active_at desc nulls last
    limit 1
  )
  select
    case when a.mode = 'online' then public.presence_status(a.last_active_at) = 'online' else false end as online,
    case when a.mode = 'offline' then null else a.last_active_at end as last_active_at,
    a.mode as visibility,
    a.full_name,
    a.avatar_url
  from admin_row a;
$$;

revoke all on function public.store_presence_for(uuid) from public;
grant execute on function public.store_presence_for(uuid) to anon, authenticated, service_role;

comment on function public.store_presence_for(uuid) is 'Presence of the store admin as one customer may see it (override → global switch). Used by the customer order page and its SSE stream.';
