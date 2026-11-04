-- =============================================================================
--  Woo Solution — complete database setup (one file)
--
--  HOW TO USE
--   1. Create a new Supabase project.
--   2. Open SQL Editor → New query, paste this WHOLE file, press Run.
--      (It is written for a fresh project; run it once.)
--   3. Project Settings → API: copy the URL, the publishable key and the secret key
--      into the app's .env.local:
--         NEXT_PUBLIC_SUPABASE_URL=…
--         NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=…
--         SUPABASE_SERVICE_ROLE_KEY=…      (server only — needed by Users → New user)
--   4. Sign up in the app once, then make yourself admin:
--         update public.profiles set is_admin = true where email = 'you@example.com';
--      Everything (dashboard, order chat, notifications, media, pages …) works from there.
--
--  WHAT IS IN HERE
--   • All 52 migrations in order — schema, RLS, triggers, functions, storage bucket.
--   • API role grants (Supabase normally sets these up; stated here so the file is
--     self-contained).
--   • OPTIONAL demo catalog at the very end (categories + products + header menu).
--     Delete that last section if you want an empty store.
--
--  Storage: the `media` bucket is created here. Nothing else has to be configured.
--  Auth: e-mail sign-up works out of the box; Google needs the provider set up in
--  Authentication → Providers (see the README).
-- =============================================================================


-- This file is meant for a NEW project. If the schema is already there, stop with a
-- readable message instead of failing halfway through a table that exists.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles') then
    raise exception 'This database already has the Woo Solution schema (public.profiles exists). Run this file only once, on a fresh Supabase project.';
  end if;
end
$$;


-- =============================================================================
-- 1. Core store — profiles, categories, products, orders, order_items, RLS, place_order()
-- (migration 20261014000000_init.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution — initial database schema
--  Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--  or with the Supabase CLI: `supabase db push`
-- =============================================================================

-- -----------------------------------------------------------------------------
--  Helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
--  PROFILES  (1:1 with auth.users, auto-created by trigger)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
--  CATEGORIES
-- -----------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Categories are viewable by everyone"
  on public.categories for select
  using (true);

-- -----------------------------------------------------------------------------
--  PRODUCTS
-- -----------------------------------------------------------------------------
create table public.products (
  id                      uuid primary key default gen_random_uuid(),
  category_id             uuid references public.categories (id) on delete set null,
  name                    text not null,
  slug                    text not null unique,
  description             text,
  price_cents             integer not null check (price_cents >= 0),
  compare_at_price_cents  integer check (compare_at_price_cents is null or compare_at_price_cents >= 0),
  image_url               text,
  stock                   integer not null default 0 check (stock >= 0),
  is_active               boolean not null default true,
  is_featured             boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);
create index products_active_created_idx on public.products (is_active, created_at desc);

alter table public.products enable row level security;

create policy "Active products are viewable by everyone"
  on public.products for select
  using (is_active = true);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
--  ORDERS
-- -----------------------------------------------------------------------------
create type public.order_status as enum ('pending', 'processing', 'completed', 'cancelled');

create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  order_number            bigint generated always as identity unique,
  user_id                 uuid references auth.users (id) on delete set null,
  status                  public.order_status not null default 'pending',
  payment_method          text not null default 'cod',
  payment_status          text not null default 'unpaid'
                            check (payment_status in ('unpaid', 'paid', 'refunded')),
  currency                text not null default 'USD',
  subtotal_cents          integer not null default 0,
  shipping_cents          integer not null default 0,
  total_cents             integer not null default 0,
  customer_email          text,
  shipping_name           text not null,
  shipping_phone          text,
  shipping_address_line1  text not null,
  shipping_address_line2  text,
  shipping_city           text not null,
  shipping_postal_code    text,
  shipping_country        text not null,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index orders_user_created_idx on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

create policy "Users can view their own orders"
  on public.orders for select
  using (auth.uid() = user_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
--  ORDER ITEMS  (price/name are snapshotted at purchase time)
-- -----------------------------------------------------------------------------
create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  product_name      text not null,
  product_slug      text,
  image_url         text,
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  quantity          integer not null check (quantity > 0),
  line_total_cents  integer generated always as (unit_price_cents * quantity) stored
);

create index order_items_order_id_idx on public.order_items (order_id);

alter table public.order_items enable row level security;

create policy "Users can view items of their own orders"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
--  SHIPPING  (flat rate, free above a threshold)
--  Keep these numbers in sync with `src/lib/config.ts`.
-- -----------------------------------------------------------------------------
create or replace function public.calculate_shipping(p_subtotal_cents integer)
returns integer
language sql
immutable
as $$
  select case
    when p_subtotal_cents >= 5000 then 0   -- free shipping at or above 50.00
    else 500                               -- flat rate 5.00
  end;
$$;

-- -----------------------------------------------------------------------------
--  PLACE ORDER  (atomic checkout)
--  * prices are taken from the database, never from the client
--  * stock is checked and decremented in the same transaction
--  * runs as SECURITY DEFINER so clients never need INSERT rights on orders
-- -----------------------------------------------------------------------------
create or replace function public.place_order(p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_email     text;
  v_order_id  uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  integer := 0;
  v_shipping  integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    if v_product.stock < v_qty then
      raise exception 'Only % left in stock for "%".', v_product.stock, v_product.name;
    end if;

    update public.products
    set stock = stock - v_qty
    where id = v_product.id;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.slug, v_product.image_url,
      v_product.price_cents, v_qty
    );

    v_subtotal := v_subtotal + v_product.price_cents * v_qty;
  end loop;

  v_shipping := public.calculate_shipping(v_subtotal);

  update public.orders
  set subtotal_cents = v_subtotal,
      shipping_cents = v_shipping,
      total_cents    = v_subtotal + v_shipping
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
revoke all on function public.place_order(jsonb, jsonb) from anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;

-- =============================================================================
-- 2. Google sign-in — profiles.avatar_url + Google-aware profile trigger
-- (migration 20261015000000_google_auth.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution — Google sign-in support
--  Run this AFTER the initial migration (Supabase SQL Editor or `supabase db push`).
--
--  OAuth users arrive with different metadata keys than e-mail sign-ups
--  (Google sends `name`, `avatar_url`, `picture` instead of `full_name`), so the
--  profile trigger now understands both, and profiles gain an avatar column.
-- =============================================================================

alter table public.profiles
  add column if not exists avatar_url text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      ''
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do update
    set full_name  = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

-- The trigger itself (`on_auth_user_created`) already exists from the initial
-- migration and automatically picks up the new function body.

-- =============================================================================
-- 3. Admin flag, admin RLS, site_settings, admin_stats() / admin_delete_user()
-- (migration 20261016000000_admin.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution — admin dashboard (/nemesis), site settings & product images
--  Run this AFTER the previous migrations (Supabase SQL Editor or `supabase db push`).
--  Idempotent: safe to run more than once on an existing project.
--
--  What it adds
--   * profiles.is_admin  – the flag that unlocks /nemesis (plus an e-mail mirror)
--   * public.is_admin()  – helper used by Row Level Security policies
--   * admin RLS policies – admins can manage products, categories, orders,
--                          order items and profiles (customers keep their own access)
--   * site_settings      – store name / tagline editable from the dashboard
--   * product-images     – public Storage bucket for product photos (admin write)
--   * admin_delete_user  – removes a customer account (auth.users → cascades)
--   * admin_stats        – numbers for the dashboard overview
--
--  After running it, promote your own account:
--    update public.profiles set is_admin = true
--    where id = (select id from auth.users where email = 'you@example.com');
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. PROFILES: admin flag + e-mail mirror (auth.users is not readable from the app)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists email    text;

create index if not exists profiles_is_admin_idx on public.profiles (is_admin) where is_admin;

update public.profiles p
set    email = u.email
from   auth.users u
where  u.id = p.id
  and  p.email is distinct from u.email;

-- Keep the profile trigger a superset of the previous versions (full_name, avatar_url) and add email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      ''
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    ),
    new.email
  )
  on conflict (id) do update
    set full_name  = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        email      = coalesce(excluded.email, public.profiles.email);
  return new;
end;
$$;

-- Keep the mirror in sync when a user changes their e-mail address.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
--  2. is_admin() helper
--     SECURITY DEFINER so it can read profiles without recursing into RLS.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Nobody can grant themselves admin rights (or forge the e-mail mirror) through
-- the regular "update my own profile" policy. Only admins — or direct database
-- access such as the SQL Editor / service role, where auth.uid() is null — may
-- change these columns.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.is_admin is distinct from old.is_admin or new.email is distinct from old.email)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'You are not allowed to change this profile field.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- -----------------------------------------------------------------------------
--  3. Admin RLS policies (added next to the existing customer policies)
-- -----------------------------------------------------------------------------
drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
  on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage categories" on public.categories;
create policy "Admins can manage categories"
  on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage orders" on public.orders;
create policy "Admins can manage orders"
  on public.orders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage order items" on public.order_items;
create policy "Admins can manage order items"
  on public.order_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  4. SITE SETTINGS (single row, id = 1)
-- -----------------------------------------------------------------------------
create table if not exists public.site_settings (
  id             smallint primary key default 1 check (id = 1),
  store_name     text not null default 'Woo Solution',
  tagline        text,
  support_email  text,
  updated_at     timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "Site settings are viewable by everyone" on public.site_settings;
create policy "Site settings are viewable by everyone"
  on public.site_settings for select
  using (true);

drop policy if exists "Admins can update site settings" on public.site_settings;
create policy "Admins can update site settings"
  on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;

-- -----------------------------------------------------------------------------
--  5. STORAGE: public bucket for product images (admins upload / replace / delete)
--     Guarded so the file also runs on plain Postgres without the storage schema.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
      )
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $sql$;

    execute 'drop policy if exists "Product images are publicly readable" on storage.objects';
    execute $sql$
      create policy "Product images are publicly readable"
        on storage.objects for select
        using (bucket_id = 'product-images')
    $sql$;

    execute 'drop policy if exists "Admins can upload product images" on storage.objects';
    execute $sql$
      create policy "Admins can upload product images"
        on storage.objects for insert to authenticated
        with check (bucket_id = 'product-images' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can update product images" on storage.objects';
    execute $sql$
      create policy "Admins can update product images"
        on storage.objects for update to authenticated
        using (bucket_id = 'product-images' and public.is_admin())
        with check (bucket_id = 'product-images' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can delete product images" on storage.objects';
    execute $sql$
      create policy "Admins can delete product images"
        on storage.objects for delete to authenticated
        using (bucket_id = 'product-images' and public.is_admin())
    $sql$;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
--  6. DELETE A USER (dashboard → Users → Delete)
--     Removing the auth.users row cascades to the profile; orders keep their
--     history with user_id = null (see the FK in the initial migration).
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete users.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account from the dashboard.';
  end if;
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'User not found.';
  end if;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.admin_delete_user(uuid) from anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- -----------------------------------------------------------------------------
--  7. DASHBOARD NUMBERS
-- -----------------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view statistics.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'revenue_cents',           coalesce((select sum(total_cents) from public.orders where status <> 'cancelled'), 0),
    'revenue_30d_cents',       coalesce((select sum(total_cents) from public.orders
                                         where status <> 'cancelled' and created_at >= now() - interval '30 days'), 0),
    'orders_total',            (select count(*) from public.orders),
    'orders_30d',              (select count(*) from public.orders where created_at >= now() - interval '30 days'),
    'orders_pending',          (select count(*) from public.orders where status = 'pending'),
    'orders_processing',       (select count(*) from public.orders where status = 'processing'),
    'orders_completed',        (select count(*) from public.orders where status = 'completed'),
    'orders_cancelled',        (select count(*) from public.orders where status = 'cancelled'),
    'products_total',          (select count(*) from public.products),
    'products_active',         (select count(*) from public.products where is_active),
    'products_low_stock',      (select count(*) from public.products where is_active and stock <= 5),
    'categories_total',        (select count(*) from public.categories),
    'customers_total',         (select count(*) from public.profiles),
    'customers_30d',           (select count(*) from public.profiles where created_at >= now() - interval '30 days')
  ) into v;

  return v;
end;
$$;

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_stats() from anon;
grant execute on function public.admin_stats() to authenticated;

-- -----------------------------------------------------------------------------
--  8. STOCK FOLLOWS ORDER STATUS
--     Cancelling an order puts its items back in stock; re-opening a cancelled
--     order takes them out again (fails if there is not enough stock left).
-- -----------------------------------------------------------------------------
create or replace function public.sync_stock_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.products p
    set    stock = p.stock + oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.products p
    set    stock = p.stock - oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_stock on public.orders;
create trigger orders_sync_stock
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_stock_on_order_status();

-- =============================================================================
-- 4. categories.show_in_menu (superseded by the menu builder, still needed in order)
-- (migration 20261017000000_category_menu.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – category visibility in the header menu
--  Run after 20261016000000_admin.sql (safe to re-run).
--
--  Adds `categories.show_in_menu`: when true the category is listed in the
--  storefront's main navigation; the category itself (and /shop?category=…)
--  keeps working either way. Toggled from /nemesis/categories.
-- =============================================================================

alter table public.categories
  add column if not exists show_in_menu boolean not null default true;

comment on column public.categories.show_in_menu is
  'Whether the category appears in the storefront header navigation.';

-- =============================================================================
-- 5. Settings tabs — contact links, favicon, SEO columns, global stock switch
-- (migration 20261018000000_settings_tabs.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – settings tabs (General · SEO · WooCommerce)
--  Run this in the Supabase SQL Editor *after* 20261017000000_category_menu.sql.
--  Idempotent: safe to run more than once.
--
--  1. New columns on site_settings (contact links, favicon, SEO, stock toggle)
--  2. public.stock_managed() – reads the global "manage stock" switch
--  3. place_order() + the order-status trigger skip stock handling when it is off
--  4. A second public storage bucket, "site-media", for favicons / share images
--     (branding files never land in the product-images bucket)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. SITE SETTINGS COLUMNS
-- -----------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists telegram                text,
  add column if not exists whatsapp                text,
  add column if not exists favicon_url             text,
  add column if not exists seo_indexing            boolean not null default true,
  add column if not exists seo_site_url            text,
  add column if not exists seo_title               text,
  add column if not exists seo_description         text,
  add column if not exists seo_og_image_url        text,
  add column if not exists seo_google_verification text,
  add column if not exists seo_bing_verification   text,
  add column if not exists seo_twitter             text,
  add column if not exists manage_stock            boolean not null default true;

comment on column public.site_settings.telegram      is 'Telegram username without @ (rendered as https://t.me/<username>)';
comment on column public.site_settings.whatsapp      is 'WhatsApp number, digits only incl. country code (rendered as https://wa.me/<digits>)';
comment on column public.site_settings.seo_indexing  is 'false = <meta name="robots" content="noindex"> + robots.txt disallow all';
comment on column public.site_settings.manage_stock  is 'false = unlimited stock for every product (no checks, no decrements)';

-- -----------------------------------------------------------------------------
--  2. GLOBAL STOCK SWITCH
--     Single source of truth for SQL *and* the app: when the row is missing we
--     behave like before (stock is managed).
-- -----------------------------------------------------------------------------
create or replace function public.stock_managed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select manage_stock from public.site_settings where id = 1), true);
$$;

grant execute on function public.stock_managed() to anon, authenticated;

-- -----------------------------------------------------------------------------
--  3a. place_order – identical to the initial migration except that the stock
--      check + decrement only run while stock management is enabled.
-- -----------------------------------------------------------------------------
create or replace function public.place_order(p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_email     text;
  v_order_id  uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  integer := 0;
  v_shipping  integer;
  v_managed   boolean := public.stock_managed();
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    if v_managed then
      if v_product.stock < v_qty then
        raise exception 'Only % left in stock for "%".', v_product.stock, v_product.name;
      end if;

      update public.products
      set stock = stock - v_qty
      where id = v_product.id;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.slug, v_product.image_url,
      v_product.price_cents, v_qty
    );

    v_subtotal := v_subtotal + v_product.price_cents * v_qty;
  end loop;

  v_shipping := public.calculate_shipping(v_subtotal);

  update public.orders
  set subtotal_cents = v_subtotal,
      shipping_cents = v_shipping,
      total_cents    = v_subtotal + v_shipping
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
revoke all on function public.place_order(jsonb, jsonb) from anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
--  3b. Cancelling / re-opening an order only moves stock while it is managed.
-- -----------------------------------------------------------------------------
create or replace function public.sync_stock_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.stock_managed() then
    return new;
  end if;

  if old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.products p
    set    stock = p.stock + oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.products p
    set    stock = p.stock - oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
--  4. STORAGE: "site-media" bucket for favicons, share images & other branding
--     (public read, admins write). Guarded like the product-images block so the
--     file also runs on plain Postgres without the storage schema.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'site-media', 'site-media', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
              'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
      )
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $sql$;

    execute 'drop policy if exists "Site media are publicly readable" on storage.objects';
    execute $sql$
      create policy "Site media are publicly readable"
        on storage.objects for select
        using (bucket_id = 'site-media')
    $sql$;

    execute 'drop policy if exists "Admins can upload site media" on storage.objects';
    execute $sql$
      create policy "Admins can upload site media"
        on storage.objects for insert to authenticated
        with check (bucket_id = 'site-media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can update site media" on storage.objects';
    execute $sql$
      create policy "Admins can update site media"
        on storage.objects for update to authenticated
        using (bucket_id = 'site-media' and public.is_admin())
        with check (bucket_id = 'site-media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can delete site media" on storage.objects';
    execute $sql$
      create policy "Admins can delete site media"
        on storage.objects for delete to authenticated
        using (bucket_id = 'site-media' and public.is_admin())
    $sql$;
  end if;
end
$$;

-- =============================================================================
-- 6. Media Library — media, folders, galleries, usage helpers + the `media` bucket
-- (migration 20261019000000_media_library.sql)
-- =============================================================================

-- =============================================================================
--  MEDIA LIBRARY (admin dashboard → Media)
--  Idempotent – safe to run more than once.
--
--  1. media_folders / media / product_media tables (+ products.image_media_id)
--  2. Row level security: admins manage everything, the storefront can read
--     files that are not in the trash (product galleries)
--  3. media_usage() – where a file is used; media_totals() – storage used
--  4. Storage bucket "media": public read, admins write, 5 MB per file,
--     any file type (the app blocks executable / HTML uploads itself)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.media_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);
create unique index if not exists media_folders_name_key on public.media_folders (lower(name));

create table if not exists public.media (
  id             uuid primary key default gen_random_uuid(),
  folder_id      uuid references public.media_folders (id) on delete set null,
  name           text not null check (char_length(name) between 1 and 200),   -- display / download name (rename never changes the URL)
  path           text not null unique,                                        -- object key inside the "media" bucket
  mime_type      text not null,
  kind           text not null check (kind in ('image', 'video', 'document', 'other')),
  size           bigint not null check (size >= 0),
  width          integer,
  height         integer,
  alt            text,
  hash           text,                                                        -- sha-256 of the file (duplicate detection)
  variants       jsonb not null default '{}'::jsonb,                          -- generated sizes: {thumbnail|medium|large: {path,width,height,size}}
  variants_size  bigint not null default 0,
  uploaded_by    uuid references auth.users (id) on delete set null,
  deleted_at     timestamptz,                                                 -- set = in the trash
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists media_library_idx on public.media (deleted_at, created_at desc);
create index if not exists media_hash_idx    on public.media (hash) where deleted_at is null;
create index if not exists media_folder_idx  on public.media (folder_id);
create index if not exists media_kind_idx    on public.media (kind);
create index if not exists media_name_idx    on public.media (lower(name));

drop trigger if exists media_set_updated_at on public.media;
create trigger media_set_updated_at
  before update on public.media
  for each row execute function public.set_updated_at();

-- products reference the library (image_url stays as the denormalised copy the storefront renders)
alter table public.products add column if not exists image_media_id uuid references public.media (id) on delete set null;
create index if not exists products_image_media_idx on public.products (image_media_id);

create table if not exists public.product_media (
  product_id  uuid not null references public.products (id) on delete cascade,
  media_id    uuid not null references public.media (id) on delete cascade,
  position    integer not null default 0,
  primary key (product_id, media_id)
);
create index if not exists product_media_media_idx on public.product_media (media_id);

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.media_folders enable row level security;
alter table public.media          enable row level security;
alter table public.product_media  enable row level security;

drop policy if exists "Admins can manage media folders" on public.media_folders;
create policy "Admins can manage media folders"
  on public.media_folders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Media are viewable by everyone" on public.media;
create policy "Media are viewable by everyone"
  on public.media for select
  using (deleted_at is null or public.is_admin());

drop policy if exists "Admins can manage media" on public.media;
create policy "Admins can manage media"
  on public.media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Product galleries are viewable by everyone" on public.product_media;
create policy "Product galleries are viewable by everyone"
  on public.product_media for select
  using (true);

drop policy if exists "Admins can manage product galleries" on public.product_media;
create policy "Admins can manage product galleries"
  on public.product_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. HELPERS
-- -----------------------------------------------------------------------------
-- Where is a file used? One row per (file, product, role). Runs with the
-- caller's rights, so RLS on products applies (admins see everything).
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql
stable
set search_path = public
as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text
    from public.products p
   where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text
    from public.product_media pm
    join public.products p on p.id = pm.product_id
   where pm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- Storage used by the library and by the trash (originals + generated sizes).
create or replace function public.media_totals()
returns table (library_count bigint, library_bytes bigint, trash_count bigint, trash_bytes bigint)
language sql
stable
set search_path = public
as $$
  select count(*) filter (where deleted_at is null),
         coalesce(sum(size + variants_size) filter (where deleted_at is null), 0)::bigint,
         count(*) filter (where deleted_at is not null),
         coalesce(sum(size + variants_size) filter (where deleted_at is not null), 0)::bigint
    from public.media;
$$;
grant execute on function public.media_totals() to authenticated;

-- -----------------------------------------------------------------------------
--  4. STORAGE: "media" bucket (public read, admins write, 5 MB, any type).
--     Guarded so the file also runs on plain Postgres without the storage schema.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 5242880, null)
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $sql$;

    execute 'drop policy if exists "Media files are publicly readable" on storage.objects';
    execute $sql$
      create policy "Media files are publicly readable"
        on storage.objects for select
        using (bucket_id = 'media')
    $sql$;

    execute 'drop policy if exists "Admins can upload media files" on storage.objects';
    execute $sql$
      create policy "Admins can upload media files"
        on storage.objects for insert to authenticated
        with check (bucket_id = 'media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can update media files" on storage.objects';
    execute $sql$
      create policy "Admins can update media files"
        on storage.objects for update to authenticated
        using (bucket_id = 'media' and public.is_admin())
        with check (bucket_id = 'media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can delete media files" on storage.objects';
    execute $sql$
      create policy "Admins can delete media files"
        on storage.objects for delete to authenticated
        using (bucket_id = 'media' and public.is_admin())
    $sql$;
  end if;
end
$$;

-- =============================================================================
-- 7. One bucket for everything — favicon / share image as media references
-- (migration 20261020000000_single_media_bucket.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – one Storage bucket for everything
-- -----------------------------------------------------------------------------
--  The Media Library ("media" bucket, migration 20261019…) now also holds the
--  branding files (favicon, social share image). This migration
--
--   1. links site_settings to media rows (favicon_media_id, seo_og_image_media_id)
--   2. teaches media_usage() about those two roles ("Used as the site favicon")
--   3. lets admins see / delete the two legacy buckets through the Storage API
--      so the in-app importer (/nemesis/media → "Legacy files") can move the old
--      files into the library and remove the buckets afterwards
--   4. removes the legacy buckets right away when they are already empty
--
--  Safe to run on an existing project (idempotent). Files that are still in
--  product-images / site-media keep working until you import them.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. SETTINGS → MEDIA LINKS (the URL columns stay as a denormalised copy)
-- -----------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists favicon_media_id      uuid references public.media (id) on delete set null,
  add column if not exists seo_og_image_media_id uuid references public.media (id) on delete set null;

-- -----------------------------------------------------------------------------
--  2. USAGE: products (main image / gallery) + site settings (favicon / share image)
-- -----------------------------------------------------------------------------
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql
stable
set search_path = public
as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text
    from public.products p
   where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text
    from public.product_media pm
    join public.products p on p.id = pm.product_id
   where pm.media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text
    from public.site_settings s
   where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text
    from public.site_settings s
   where s.seo_og_image_media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
--  3./4. LEGACY BUCKETS (guarded – also runs on plain Postgres without storage)
-- -----------------------------------------------------------------------------
do $$
declare
  legacy text[] := array['product-images', 'site-media'];
  b text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  -- Admins may look at and delete *only* the two legacy buckets (storage-js
  -- getBucket() / deleteBucket() go through RLS on storage.buckets).
  begin
    execute 'drop policy if exists "Admins can see legacy media buckets" on storage.buckets';
    execute $sql$
      create policy "Admins can see legacy media buckets"
        on storage.buckets for select to authenticated
        using (id in ('product-images', 'site-media') and public.is_admin())
    $sql$;
    execute 'drop policy if exists "Admins can delete legacy media buckets" on storage.buckets';
    execute $sql$
      create policy "Admins can delete legacy media buckets"
        on storage.buckets for delete to authenticated
        using (id in ('product-images', 'site-media') and public.is_admin())
    $sql$;
  exception when others then
    raise notice 'storage.buckets policies skipped: %', sqlerrm;
  end;

  -- Buckets that are already empty disappear now; the rest after the import.
  foreach b in array legacy loop
    begin
      if not exists (select 1 from storage.objects o where o.bucket_id = b) then
        delete from storage.buckets where id = b;
      end if;
    exception when others then
      raise notice 'bucket % left in place: %', b, sqlerrm;
    end;
  end loop;

  -- The per-bucket object policies are only needed while a legacy bucket exists.
  if not exists (select 1 from storage.buckets where id = 'product-images') then
    execute 'drop policy if exists "Product images are publicly readable" on storage.objects';
    execute 'drop policy if exists "Admins can upload product images" on storage.objects';
    execute 'drop policy if exists "Admins can update product images" on storage.objects';
    execute 'drop policy if exists "Admins can delete product images" on storage.objects';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-media') then
    execute 'drop policy if exists "Site media are publicly readable" on storage.objects';
    execute 'drop policy if exists "Admins can upload site media" on storage.objects';
    execute 'drop policy if exists "Admins can update site media" on storage.objects';
    execute 'drop policy if exists "Admins can delete site media" on storage.objects';
  end if;
end
$$;

-- =============================================================================
-- 8. Pages — pages, tags, page_tags, page_media + RLS
-- (migration 20261021000000_pages.sql)
-- =============================================================================

-- =============================================================================
--  PAGES (admin dashboard → Pages): About us, Contact, Privacy policy, FAQ …
--  Idempotent – safe to run more than once.
--
--  1. pages            one row per page: title, slug, sanitised HTML content,
--                      featured image (Media Library), SEO fields, status,
--                      author, published_at
--     tags / page_tags optional, reusable tags (unique regardless of case)
--     page_media       images used *inside* the content (usage tracking)
--  2. Row level security: everyone can read published pages (and their
--     tags), admins manage everything
--  3. media_usage() also reports pages (featured image / share image / content)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.pages (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 200),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  content            text not null default '',                                  -- sanitised HTML from the editor
  excerpt            text,                                                      -- plain-text summary derived from the content (default meta description)
  featured_image_id  uuid references public.media (id) on delete set null,
  status             text not null default 'draft' check (status in ('draft', 'published')),
  seo_title          text check (char_length(seo_title) <= 120),
  seo_description    text check (char_length(seo_description) <= 320),
  canonical_url      text check (char_length(canonical_url) <= 500),
  robots_index       boolean not null default true,
  robots_follow      boolean not null default true,
  og_title           text check (char_length(og_title) <= 120),
  og_description     text check (char_length(og_description) <= 320),
  og_image_id        uuid references public.media (id) on delete set null,
  author_id          uuid references public.profiles (id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists pages_status_idx    on public.pages (status, published_at desc);
create index if not exists pages_updated_idx   on public.pages (updated_at desc);
create index if not exists pages_title_idx     on public.pages (lower(title));
create index if not exists pages_featured_idx  on public.pages (featured_image_id);
create index if not exists pages_og_image_idx  on public.pages (og_image_id);

drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 50),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz not null default now()
);
create unique index if not exists tags_name_key on public.tags (lower(name));

create table if not exists public.page_tags (
  page_id   uuid not null references public.pages (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  position  integer not null default 0,
  primary key (page_id, tag_id)
);
create index if not exists page_tags_tag_idx on public.page_tags (tag_id);

-- Media Library images referenced from inside the content (<img data-media-id>)
create table if not exists public.page_media (
  page_id   uuid not null references public.pages (id) on delete cascade,
  media_id  uuid not null references public.media (id) on delete cascade,
  primary key (page_id, media_id)
);
create index if not exists page_media_media_idx on public.page_media (media_id);

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.pages      enable row level security;
alter table public.tags       enable row level security;
alter table public.page_tags  enable row level security;
alter table public.page_media enable row level security;

drop policy if exists "Published pages are viewable by everyone" on public.pages;
create policy "Published pages are viewable by everyone"
  on public.pages for select
  using (status = 'published' or public.is_admin());

drop policy if exists "Admins can manage pages" on public.pages;
create policy "Admins can manage pages"
  on public.pages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Tags are viewable by everyone" on public.tags;
create policy "Tags are viewable by everyone"
  on public.tags for select
  using (true);

drop policy if exists "Admins can manage tags" on public.tags;
create policy "Admins can manage tags"
  on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Page tags are viewable by everyone" on public.page_tags;
create policy "Page tags are viewable by everyone"
  on public.page_tags for select
  using (true);  -- the page itself is protected by the pages policy

drop policy if exists "Admins can manage page tags" on public.page_tags;
create policy "Admins can manage page tags"
  on public.page_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage page media" on public.page_media;
create policy "Admins can manage page media"
  on public.page_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. USAGE: products + site settings + pages
--     (product_* columns double as page id / title / slug for the page roles)
-- -----------------------------------------------------------------------------
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql
stable
set search_path = public
as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text
    from public.products p
   where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text
    from public.product_media pm
    join public.products p on p.id = pm.product_id
   where pm.media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text
    from public.site_settings s
   where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text
    from public.site_settings s
   where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text
    from public.pages pg
   where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text
    from public.pages pg
   where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text
    from public.page_media pm
    join public.pages pg on pg.id = pm.page_id
   where pm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- =============================================================================
-- 9. External featured / share image URLs for pages
-- (migration 20261022000000_pages_image_urls.sql)
-- =============================================================================

-- =============================================================================
--  PAGES – external image URLs (admin dashboard → Pages → "Use a URL")
--  Idempotent – safe to run more than once.
--
--  The featured image and the social share image of a page can either be a
--  Media Library file (featured_image_id / og_image_id) or any public image
--  URL (featured_image_url / og_image_url) – the same choice the product form
--  offers. The app keeps exactly one of the two per image.
-- =============================================================================
alter table public.pages
  add column if not exists featured_image_url text
    check (featured_image_url is null or (length(featured_image_url) <= 2000 and featured_image_url ~* '^https?://')),
  add column if not exists og_image_url text
    check (og_image_url is null or (length(og_image_url) <= 2000 and og_image_url ~* '^https?://'));

comment on column public.pages.featured_image_url is 'External featured image (used when featured_image_id is null)';
comment on column public.pages.og_image_url       is 'External social share image (used when og_image_id is null)';

notify pgrst, 'reload schema';

-- =============================================================================
-- 10. Menus — menu_items for the header / footer navigation
-- (migration 20261023000000_menus.sql)
-- =============================================================================

-- =============================================================================
--  MENUS (admin dashboard → UI → Menu): storefront header and footer navigation
--  Idempotent – safe to run more than once.
--
--  1. menu_items   one row per link, per location (header / footer): a page,
--                  a category or a custom URL, each with its own display title,
--                  "open in a new tab" flag and position
--  2. RLS          everyone reads, admins manage
--  3. Data         the header menu starts as "Shop" + the categories that were
--                  flagged "Show in header menu"; the footer keeps the links it
--                  used to show (Shop, Cart, My orders). The old
--                  categories.show_in_menu column is dropped – menus are now
--                  managed only under UI → Menu.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.menu_items (
  id               uuid primary key default gen_random_uuid(),
  location         text not null check (location in ('header', 'footer')),
  kind             text not null check (kind in ('page', 'category', 'custom')),
  title            text not null check (char_length(title) between 1 and 80),   -- display text (editable, independent of the page / category name)
  page_id          uuid references public.pages (id) on delete cascade,         -- kind = 'page'
  category_id      uuid references public.categories (id) on delete cascade,    -- kind = 'category'
  url              text check (char_length(url) <= 500),                        -- kind = 'custom': /path, https://…, mailto:, tel:
  open_in_new_tab  boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint menu_items_target check (
    (kind = 'page'     and page_id is not null     and category_id is null and url is null) or
    (kind = 'category' and category_id is not null and page_id is null     and url is null) or
    (kind = 'custom'   and url is not null         and page_id is null     and category_id is null)
  )
);
create index if not exists menu_items_location_idx on public.menu_items (location, sort_order);
create index if not exists menu_items_page_idx     on public.menu_items (page_id);
create index if not exists menu_items_category_idx on public.menu_items (category_id);

comment on table public.menu_items is 'Storefront navigation (header / footer), managed under UI → Menu in the dashboard.';

drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.menu_items enable row level security;

drop policy if exists "Menu items are viewable by everyone" on public.menu_items;
create policy "Menu items are viewable by everyone"
  on public.menu_items for select
  using (true);

drop policy if exists "Admins can manage menu items" on public.menu_items;
create policy "Admins can manage menu items"
  on public.menu_items for all
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. DATA – carry the current navigation over, then retire show_in_menu
-- -----------------------------------------------------------------------------
do $$
begin
  -- First run on a project: the links the storefront rendered until now.
  if not exists (select 1 from public.menu_items) then
    insert into public.menu_items (location, kind, title, url, sort_order) values
      ('header', 'custom', 'Shop',      '/shop',   0),
      ('footer', 'custom', 'Shop',      '/shop',   0),
      ('footer', 'custom', 'Cart',      '/cart',   1),
      ('footer', 'custom', 'My orders', '/orders', 2);
  end if;

  -- Categories that were shown in the header keep their place (after "Shop", in their sort order).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'categories' and column_name = 'show_in_menu'
  ) then
    insert into public.menu_items (location, kind, title, category_id, sort_order)
    select 'header', 'category', c.name, c.id,
           (select coalesce(max(sort_order), -1) from public.menu_items where location = 'header')
             + row_number() over (order by c.sort_order, c.name)
    from public.categories c
    where c.show_in_menu
      and not exists (select 1 from public.menu_items m where m.location = 'header' and m.category_id = c.id);

    alter table public.categories drop column show_in_menu;
  end if;
end $$;

-- =============================================================================
-- 11. Home page section switches + filter title
-- (migration 20261024000000_home_sections.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – home page sections (UI → Home page)
--  Run this in the Supabase SQL Editor *after* 20261023000000_menus.sql.
--  Idempotent: safe to run more than once.
--
--  Four columns on site_settings decide which sections the storefront home
--  page renders (and the heading of the filtered-products section):
--    home_show_categories  "Shop by category" tiles              (default on)
--    home_show_featured    "Featured products" grid              (default on)
--    home_show_filter      shop-style category filter + products (default off)
--    home_filter_title     heading above that filter, free text  (optional)
--  Defaults reproduce the home page exactly as it was before this migration.
-- =============================================================================

alter table public.site_settings
  add column if not exists home_show_categories boolean not null default true,
  add column if not exists home_show_featured   boolean not null default true,
  add column if not exists home_show_filter     boolean not null default false,
  add column if not exists home_filter_title    text;

comment on column public.site_settings.home_show_categories is 'Home page: render the "Shop by category" tiles';
comment on column public.site_settings.home_show_featured   is 'Home page: render the "Featured products" grid';
comment on column public.site_settings.home_show_filter     is 'Home page: render the shop-style category filter with its product grid';
comment on column public.site_settings.home_filter_title    is 'Heading above the filtered-products section (null = no heading)';

-- PostgREST: pick up the new columns right away
notify pgrst, 'reload schema';

-- =============================================================================
-- 12. Currency — USD / BDT + the USD→BDT rate, orders.exchange_rate
-- (migration 20261025000000_currency.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – store currency (Settings → WooCommerce → Currency)
--  Run this in the Supabase SQL Editor *after* 20261024000000_home_sections.sql.
--  Idempotent: safe to run more than once.
--
--  Prices stay in the base currency – US dollar cents – in `products` and `orders`.
--  The store currency only decides what people *see*: with BDT selected every amount
--  is shown as base × the USD→BDT rate (and prices typed into the admin in BDT are
--  converted back before they are stored). Orders stamp the currency and the rate
--  that applied at checkout, so an order keeps showing the amounts the customer
--  agreed to, whatever the rate is today.
-- =============================================================================

-- 1. settings: the selected currency + the USD → BDT rate
alter table public.site_settings
  add column if not exists currency         text          not null default 'USD',
  add column if not exists usd_to_bdt_rate  numeric(12,4);

alter table public.site_settings drop constraint if exists site_settings_currency_check;
alter table public.site_settings
  add constraint site_settings_currency_check check (currency in ('USD', 'BDT'));

alter table public.site_settings drop constraint if exists site_settings_usd_to_bdt_rate_check;
alter table public.site_settings
  add constraint site_settings_usd_to_bdt_rate_check check (usd_to_bdt_rate is null or usd_to_bdt_rate > 0);

comment on column public.site_settings.currency        is 'Store currency shown to customers: USD or BDT (prices are stored in USD cents)';
comment on column public.site_settings.usd_to_bdt_rate is '1 USD = this many BDT; used whenever currency = BDT';

-- 2. orders remember the currency + rate they were placed with
alter table public.orders
  add column if not exists exchange_rate numeric(12,4) not null default 1;

comment on column public.orders.currency      is 'Currency the customer saw at checkout (USD or BDT). Amounts stay in USD cents – multiply by exchange_rate to display.';
comment on column public.orders.exchange_rate is 'USD → orders.currency rate stamped at checkout (1 for USD orders)';

-- 3. place_order – identical to 20261018000000_settings_tabs.sql except that the
--    order is stamped with the store currency and the rate in force at checkout.
create or replace function public.place_order(p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_email     text;
  v_order_id  uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  integer := 0;
  v_shipping  integer;
  v_managed   boolean := public.stock_managed();
  v_currency  text := 'USD';
  v_rate      numeric := 1;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  -- the currency the customer is looking at right now (BDT only with a usable rate)
  select case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then 'BDT' else 'USD' end,
         case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then s.usd_to_bdt_rate else 1 end
    into v_currency, v_rate
    from public.site_settings s
   where s.id = 1;
  if v_currency is null then
    v_currency := 'USD';
    v_rate := 1;
  end if;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes, currency, exchange_rate
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', ''), v_currency, v_rate
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    if v_managed then
      if v_product.stock < v_qty then
        raise exception 'Only % left in stock for "%".', v_product.stock, v_product.name;
      end if;

      update public.products
      set stock = stock - v_qty
      where id = v_product.id;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, image_url, unit_price_cents, quantity
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.slug, v_product.image_url,
      v_product.price_cents, v_qty
    );

    v_subtotal := v_subtotal + v_product.price_cents * v_qty;
  end loop;

  v_shipping := public.calculate_shipping(v_subtotal);

  update public.orders
  set subtotal_cents = v_subtotal,
      shipping_cents = v_shipping,
      total_cents    = v_subtotal + v_shipping
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
revoke all on function public.place_order(jsonb, jsonb) from anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;

-- PostgREST: pick up the new columns right away
notify pgrst, 'reload schema';

-- =============================================================================
-- 13. Money precision — every amount becomes integer USD micro-dollars
-- (migration 20261026000000_money_micros.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – price precision: amounts become micro-dollars
--
--  Fixes: a price typed in the admin while BDT is selected did not come back as
--  the amount that was typed – 100 ৳ was stored as 83¢ and read back as 99.60 ৳,
--  1 ৳ came back as 1.20 ৳.
--
--  Why: amounts were kept as *US cents* while the store could display BDT, and one
--  cent is 1.20 ৳ at a rate of 120 – so every taka price was snapped to that grid.
--
--  The base unit becomes the **micro-dollar**: 1 USD = 1,000,000 micros
--  (1 cent = 10,000 micros, a micro is a ten-thousandth of a cent). That is fine
--  enough for any amount an admin can type in either currency and still a safe
--  JavaScript integer. Columns are renamed `*_cents` → `*_micros` and widened to
--  `bigint`; existing amounts are multiplied by 10,000, so no price changes value.
--
--  Run this in the Supabase SQL Editor *after* 20261025000000_currency.sql, and
--  install the matching app release at the same time – they are not compatible
--  with each other. Idempotent: safe to run more than once.
-- =============================================================================

-- 1. products / orders / order_items: widen, convert, rename
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'products' and column_name = 'price_cents') then
    alter table public.products alter column price_cents            type bigint;
    alter table public.products alter column compare_at_price_cents type bigint;
    update public.products
       set price_cents            = price_cents * 10000,
           compare_at_price_cents = compare_at_price_cents * 10000;
    alter table public.products rename column price_cents            to price_micros;
    alter table public.products rename column compare_at_price_cents to compare_at_price_micros;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'orders' and column_name = 'total_cents') then
    alter table public.orders alter column subtotal_cents type bigint;
    alter table public.orders alter column shipping_cents type bigint;
    alter table public.orders alter column total_cents    type bigint;
    update public.orders
       set subtotal_cents = subtotal_cents * 10000,
           shipping_cents = shipping_cents * 10000,
           total_cents    = total_cents * 10000;
    alter table public.orders rename column subtotal_cents to subtotal_micros;
    alter table public.orders rename column shipping_cents to shipping_micros;
    alter table public.orders rename column total_cents    to total_micros;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_items' and column_name = 'unit_price_cents') then
    -- the generated total has to go first: it is an int4 product that would overflow
    alter table public.order_items drop column if exists line_total_cents;
    alter table public.order_items alter column unit_price_cents type bigint;
    update public.order_items set unit_price_cents = unit_price_cents * 10000;
    alter table public.order_items rename column unit_price_cents to unit_price_micros;
    alter table public.order_items
      add column line_total_micros bigint generated always as (unit_price_micros * quantity) stored;
  end if;
end $$;

comment on column public.products.price_micros            is 'Price in USD micro-dollars (1 USD = 1,000,000) – the base unit; display currency is a setting';
comment on column public.products.compare_at_price_micros is 'Compare-at price in USD micro-dollars, or null';
comment on column public.orders.subtotal_micros           is 'Items subtotal in USD micro-dollars (display: multiply by orders.exchange_rate)';
comment on column public.orders.shipping_micros           is 'Shipping in USD micro-dollars';
comment on column public.orders.total_micros              is 'Order total in USD micro-dollars';
comment on column public.order_items.unit_price_micros    is 'Unit price in USD micro-dollars at the time of the order';
comment on column public.order_items.line_total_micros    is 'unit_price_micros × quantity';

-- 2. shipping: same rules, amounts now in micros ($5.00 / $50.00)
drop function if exists public.calculate_shipping(integer);

create or replace function public.calculate_shipping(p_subtotal_micros bigint)
returns bigint
language sql
immutable
as $$
  select case
    when p_subtotal_micros >= 50000000 then 0::bigint     -- free shipping at or above $50.00
    else 5000000::bigint                                  -- flat rate $5.00
  end;
$$;

comment on function public.calculate_shipping(bigint) is 'Flat $5 shipping, free at or above $50 (amounts in USD micro-dollars)';

-- 3. place_order – identical to 20261025000000_currency.sql except for the base unit
create or replace function public.place_order(p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_email     text;
  v_order_id  uuid;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_subtotal  bigint := 0;
  v_shipping  bigint;
  v_managed   boolean := public.stock_managed();
  v_currency  text := 'USD';
  v_rate      numeric := 1;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  -- the currency the customer is looking at right now (BDT only with a usable rate)
  select case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then 'BDT' else 'USD' end,
         case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then s.usd_to_bdt_rate else 1 end
    into v_currency, v_rate
    from public.site_settings s
   where s.id = 1;
  if v_currency is null then
    v_currency := 'USD';
    v_rate := 1;
  end if;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes, currency, exchange_rate
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', ''), v_currency, v_rate
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    if v_managed and v_product.stock < v_qty then
      raise exception 'Only % left of %.', v_product.stock, v_product.name;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, product_slug, image_url, unit_price_micros, quantity
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.slug,
      v_product.image_url, v_product.price_micros, v_qty
    );

    v_subtotal := v_subtotal + v_product.price_micros * v_qty;

    if v_managed then
      update public.products set stock = stock - v_qty where id = v_product.id;
    end if;
  end loop;

  v_shipping := public.calculate_shipping(v_subtotal);

  update public.orders
     set subtotal_micros = v_subtotal,
         shipping_micros = v_shipping,
         total_micros    = v_subtotal + v_shipping
   where id = v_order_id;

  return v_order_id;
end $$;

-- 4. dashboard numbers: same shape, micros
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view statistics.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'revenue_micros',          coalesce((select sum(total_micros) from public.orders where status <> 'cancelled'), 0),
    'revenue_30d_micros',      coalesce((select sum(total_micros) from public.orders
                                         where status <> 'cancelled' and created_at >= now() - interval '30 days'), 0),
    'orders_total',            (select count(*) from public.orders),
    'orders_30d',              (select count(*) from public.orders where created_at >= now() - interval '30 days'),
    'orders_pending',          (select count(*) from public.orders where status = 'pending'),
    'orders_processing',       (select count(*) from public.orders where status = 'processing'),
    'orders_completed',        (select count(*) from public.orders where status = 'completed'),
    'orders_cancelled',        (select count(*) from public.orders where status = 'cancelled'),
    'products_total',          (select count(*) from public.products),
    'products_active',         (select count(*) from public.products where is_active),
    'products_low_stock',      (select count(*) from public.products where is_active and stock <= 5),
    'categories_total',        (select count(*) from public.categories)
  ) into v;

  return v;
end $$;

-- 5. money columns stay non-negative – same rules, names matching the new columns
alter table public.products    drop constraint if exists products_price_cents_check;
alter table public.products    drop constraint if exists products_price_micros_check;
alter table public.products    add  constraint products_price_micros_check check (price_micros >= 0);
alter table public.products    drop constraint if exists products_compare_at_price_cents_check;
alter table public.products    drop constraint if exists products_compare_at_price_micros_check;
alter table public.products    add  constraint products_compare_at_price_micros_check
  check (compare_at_price_micros is null or compare_at_price_micros >= 0);
alter table public.order_items drop constraint if exists order_items_unit_price_cents_check;
alter table public.order_items drop constraint if exists order_items_unit_price_micros_check;
alter table public.order_items add  constraint order_items_unit_price_micros_check check (unit_price_micros >= 0);

-- =============================================================================
-- 14. Variable products — attributes, variations, place_order() per variation
-- (migration 20261027000000_variations.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – variable products
--
--  Products are either `simple` (one price, one stock count) or `variable`:
--
--    product_attributes   the axes the admin defines        e.g. Color: Red, Blue
--    product_variations   one row per combination           e.g. Red / Small
--
--  Every combination keeps its own SKU, price, sale (compare-at) price, stock,
--  image and enabled flag. `combination` is a jsonb map {attribute: value} and
--  `label` is the display text ("Red / Small") built by the app.
--
--  A trigger keeps the parent product in step for the storefront: `price_micros`
--  becomes the cheapest enabled variation ("From ৳…" on the cards), `stock` the
--  sum of the enabled variations' stock, and `compare_at_price_micros` is cleared
--  (each variation has its own). Listings, filters, sorting and the cart all keep
--  reading a single product row, and orders decrement the variation they bought.
--
--  Run in the Supabase SQL Editor *after* 20261026000000_money_micros.sql.
--  Idempotent: safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. PRODUCTS: type + SKU
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists type text not null default 'simple',
  add column if not exists sku  text;

alter table public.products drop constraint if exists products_type_check;
alter table public.products add  constraint products_type_check check (type in ('simple', 'variable'));

comment on column public.products.type is 'simple = own price/stock, variable = price/stock come from product_variations';
comment on column public.products.sku  is 'Optional stock-keeping unit (simple products; variations carry their own)';

-- -----------------------------------------------------------------------------
--  2. ATTRIBUTES  (the axes: Color → Red, Blue, Green)
-- -----------------------------------------------------------------------------
create table if not exists public.product_attributes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  options    text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_attributes_product_name_idx
  on public.product_attributes (product_id, lower(trim(name)));
create index if not exists product_attributes_product_idx on public.product_attributes (product_id, sort_order);

comment on table  public.product_attributes       is 'Variable-product axes defined by the admin (Color, Size, …)';
comment on column public.product_attributes.options is 'The values of this attribute, in the order the admin entered them';

drop trigger if exists product_attributes_set_updated_at on public.product_attributes;
create trigger product_attributes_set_updated_at
  before update on public.product_attributes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
--  3. VARIATIONS  (one row per combination)
-- -----------------------------------------------------------------------------
create table if not exists public.product_variations (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  sku                   text,
  price_micros          bigint not null check (price_micros >= 0),
  compare_at_price_micros bigint check (compare_at_price_micros is null or compare_at_price_micros >= 0),
  stock                 integer not null default 0 check (stock >= 0),
  is_active             boolean not null default true,
  image_url             text,
  image_media_id        uuid references public.media (id) on delete set null,
  combination           jsonb not null default '{}'::jsonb,
  label                 text not null default '',
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists product_variations_product_idx on public.product_variations (product_id, sort_order);
create unique index if not exists product_variations_combination_idx
  on public.product_variations (product_id, md5(combination::text));

comment on table  public.product_variations            is 'One purchasable combination of a variable product (Red / Small)';
comment on column public.product_variations.combination is 'jsonb map of attribute name → value, e.g. {"Color":"Red","Size":"Small"}';
comment on column public.product_variations.label       is 'Display text for the combination, e.g. "Red / Small"';
comment on column public.product_variations.is_active   is 'Disabled variations stay in the admin but cannot be bought';

drop trigger if exists product_variations_set_updated_at on public.product_variations;
create trigger product_variations_set_updated_at
  before update on public.product_variations
  for each row execute function public.set_updated_at();

-- RLS: the storefront reads variations/attributes of active products, admins write them.
alter table public.product_attributes enable row level security;
alter table public.product_variations enable row level security;

drop policy if exists "Product attributes are viewable by everyone" on public.product_attributes;
create policy "Product attributes are viewable by everyone"
  on public.product_attributes for select
  using (true);

drop policy if exists "Admins can manage product attributes" on public.product_attributes;
create policy "Admins can manage product attributes"
  on public.product_attributes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Product variations are viewable by everyone" on public.product_variations;
create policy "Product variations are viewable by everyone"
  on public.product_variations for select
  using (true);

drop policy if exists "Admins can manage product variations" on public.product_variations;
create policy "Admins can manage product variations"
  on public.product_variations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  4. PARENT PRODUCT FOLLOWS ITS VARIATIONS
--     price  = cheapest enabled variation ("From …"), stock = sum of enabled ones
-- -----------------------------------------------------------------------------
create or replace function public.sync_variation_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_min_price  bigint;
  v_stock      integer;
begin
  -- `new` is unassigned on DELETE, so branch on the operation
  v_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;

  select min(price_micros), coalesce(sum(stock), 0)
    into v_min_price, v_stock
    from public.product_variations
   where product_id = v_product_id
     and is_active;

  if v_min_price is not null then
    update public.products
       set price_micros            = v_min_price,
           compare_at_price_micros = null,
           stock                   = v_stock
     where id = v_product_id
       and type = 'variable';
  else
    -- no enabled variation left: nothing is buyable, so show it as sold out
    update public.products
       set stock = 0
     where id = v_product_id
       and type = 'variable';
  end if;

  return null;
end $$;

drop trigger if exists product_variations_sync_parent on public.product_variations;
create trigger product_variations_sync_parent
  after insert or update or delete on public.product_variations
  for each row execute function public.sync_variation_parent();

-- -----------------------------------------------------------------------------
--  5. ORDER ITEMS remember which variation was bought
-- -----------------------------------------------------------------------------
alter table public.order_items
  add column if not exists variation_id    uuid references public.product_variations (id) on delete set null,
  add column if not exists variation_label text;

comment on column public.order_items.variation_label is 'Which combination was bought, e.g. "Red / Small"';

-- -----------------------------------------------------------------------------
--  6. PLACE ORDER – identical to 20261026000000_money_micros.sql except that an
--     item may name a `variation_id`: its own price/stock is used and only that
--     variation is decremented (the parent stock follows by trigger).
-- -----------------------------------------------------------------------------
create or replace function public.place_order(p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_email       text;
  v_order_id    uuid;
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_variation   public.product_variations%rowtype;
  v_variation_id uuid;
  v_qty         integer;
  v_price       bigint;
  v_stock       integer;
  v_label       text;
  v_subtotal    bigint := 0;
  v_shipping    bigint;
  v_managed     boolean := public.stock_managed();
  v_currency    text := 'USD';
  v_rate        numeric := 1;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  -- the currency the customer is looking at right now (BDT only with a usable rate)
  select case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then 'BDT' else 'USD' end,
         case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then s.usd_to_bdt_rate else 1 end
    into v_currency, v_rate
    from public.site_settings s
   where s.id = 1;
  if v_currency is null then
    v_currency := 'USD';
    v_rate := 1;
  end if;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes, currency, exchange_rate
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', ''), v_currency, v_rate
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    v_variation_id := nullif(coalesce(v_item ->> 'variation_id', ''), '')::uuid;
    v_label        := null;

    if v_variation_id is not null then
      -- a variable product: price and stock come from the chosen combination
      select * into v_variation
      from public.product_variations
      where id = v_variation_id
        and product_id = v_product.id
        and is_active
      for update;

      if not found then
        raise exception 'That option of % is no longer available.', v_product.name;
      end if;

      v_price := v_variation.price_micros;
      v_stock := v_variation.stock;
      v_label := coalesce(nullif(v_variation.label, ''), 'Selected option');

      if v_managed and v_stock < v_qty then
        raise exception 'Only % left of % – %.', v_stock, v_product.name, v_label;
      end if;

      insert into public.order_items (
        order_id, product_id, product_name, product_slug, image_url,
        unit_price_micros, quantity, variation_id, variation_label
      ) values (
        v_order_id, v_product.id, v_product.name, v_product.slug,
        coalesce(v_variation.image_url, v_product.image_url),
        v_price, v_qty, v_variation.id, v_label
      );

      if v_managed then
        update public.product_variations set stock = stock - v_qty where id = v_variation.id;
      end if;
    else
      v_price := v_product.price_micros;
      v_stock := v_product.stock;

      if v_managed and v_stock < v_qty then
        raise exception 'Only % left of %.', v_stock, v_product.name;
      end if;

      insert into public.order_items (
        order_id, product_id, product_name, product_slug, image_url, unit_price_micros, quantity
      ) values (
        v_order_id, v_product.id, v_product.name, v_product.slug,
        v_product.image_url, v_price, v_qty
      );

      if v_managed then
        update public.products set stock = stock - v_qty where id = v_product.id;
      end if;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  v_shipping := public.calculate_shipping(v_subtotal);

  update public.orders
     set subtotal_micros = v_subtotal,
         shipping_micros = v_shipping,
         total_micros    = v_subtotal + v_shipping
   where id = v_order_id;

  return v_order_id;
end $$;

-- -----------------------------------------------------------------------------
--  7. STOCK FOLLOWS ORDER STATUS – as in 20261016000000_admin.sql, extended so a
--     cancelled variation line is returned to its own variation (the parent
--     product stock follows by trigger).
-- -----------------------------------------------------------------------------
create or replace function public.sync_stock_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- the global stock switch still wins: with stock management off, cancelling rewrites nothing
  if not public.stock_managed() then
    return new;
  end if;

  if old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.product_variations v
    set    stock = v.stock + oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.variation_id = v.id;

    update public.products p
    set    stock = p.stock + oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id and oi.variation_id is null;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.product_variations v
    set    stock = v.stock - oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.variation_id = v.id;

    update public.products p
    set    stock = p.stock - oi.quantity
    from   public.order_items oi
    where  oi.order_id = new.id and oi.product_id = p.id and oi.variation_id is null;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
--  8. MEDIA USAGE: variation images count as an in-use role
-- -----------------------------------------------------------------------------
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql
stable
set search_path = public
as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text
    from public.products p
   where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text
    from public.product_media pm
    join public.products p on p.id = pm.product_id
   where pm.media_id = any (p_ids)
  union all
  select v.image_media_id, p.id, p.name, p.slug, 'variation'::text
    from public.product_variations v
    join public.products p on p.id = v.product_id
   where v.image_media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text
    from public.site_settings s
   where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text
    from public.site_settings s
   where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text
    from public.pages pg
   where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text
    from public.pages pg
   where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text
    from public.page_media pm
    join public.pages pg on pg.id = pm.page_id
   where pm.media_id = any (p_ids);
$$;

grant execute on function public.media_usage(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
--  9. Backfill: rows that already had a catalogue of options stay simple
-- -----------------------------------------------------------------------------
update public.products set type = 'simple' where type is null;

-- =============================================================================
-- 15. Dashboard customer counts restored in admin_stats()
-- (migration 20261028000000_admin_stats_customers.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – dashboard customer counts
--
--  `20261026000000_money_micros.sql` re-created `admin_stats()` for the
--  micro-dollar move and, in the rewrite, dropped the two customer keys the
--  dashboard reads:
--
--    customers_total   number of accounts (public.profiles rows)
--    customers_30d     accounts created in the last 30 days
--
--  Without them the Customers card rendered "undefined joined in the last 30
--  days". This migration restores both keys; every other key keeps the shape
--  from the money rewrite (revenue_micros, orders_*, products_*).
-- =============================================================================

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view statistics.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'revenue_micros',          coalesce((select sum(total_micros) from public.orders where status <> 'cancelled'), 0),
    'revenue_30d_micros',      coalesce((select sum(total_micros) from public.orders
                                         where status <> 'cancelled' and created_at >= now() - interval '30 days'), 0),
    'orders_total',            (select count(*) from public.orders),
    'orders_30d',              (select count(*) from public.orders where created_at >= now() - interval '30 days'),
    'orders_pending',          (select count(*) from public.orders where status = 'pending'),
    'orders_processing',       (select count(*) from public.orders where status = 'processing'),
    'orders_completed',        (select count(*) from public.orders where status = 'completed'),
    'orders_cancelled',        (select count(*) from public.orders where status = 'cancelled'),
    'products_total',          (select count(*) from public.products),
    'products_active',         (select count(*) from public.products where is_active),
    'products_low_stock',      (select count(*) from public.products where is_active and stock <= 5),
    'categories_total',        (select count(*) from public.categories),
    'customers_total',         (select count(*) from public.profiles),
    'customers_30d',           (select count(*) from public.profiles where created_at >= now() - interval '30 days')
  ) into v;

  return v;
end $$;

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_stats() from anon;
grant execute on function public.admin_stats() to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- 16. Theme customization — palettes, gradients, theme_sync
-- (migration 20261029000000_theme.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – theme customization
--
--  Extra → Theme Customization stores its palette on the single `site_settings`
--  row so the storefront (and the dashboard) restyle themselves on the next
--  request – no rebuild, no extra table to join:
--
--    theme_light     { primary, secondary, button, button_hover, loader }  (null = template default)
--    theme_dark      the same five keys for dark mode
--    theme_gradients { button: {...}, loader: {...}, hero: {...} }
--    theme_sync      true = dark mode reuses the light palette
--
--  Colours are stored exactly as the admin typed them (hex / rgb() / hsl()) –
--  the app validates them (src/lib/theme.ts) before writing, and simply omits
--  a key the admin never touched so the template keeps its own value.
-- =============================================================================

alter table public.site_settings
  add column if not exists theme_light     jsonb   not null default '{}'::jsonb,
  add column if not exists theme_dark      jsonb   not null default '{}'::jsonb,
  add column if not exists theme_gradients jsonb   not null default '{}'::jsonb,
  add column if not exists theme_sync      boolean not null default false;

comment on column public.site_settings.theme_light is
  'Extra → Theme Customization: light-mode overrides {primary, secondary, button, button_hover, loader}';
comment on column public.site_settings.theme_dark is
  'Extra → Theme Customization: dark-mode overrides (same keys as theme_light)';
comment on column public.site_settings.theme_gradients is
  'Extra → Theme Customization: gradients for {button, loader, hero}';

notify pgrst, 'reload schema';

-- =============================================================================
-- 17. Order inquiries — the per-order chat thread
-- (migration 20261030000000_order_messages.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  ORDER MESSAGES — the turn-based inquiry chat on an order
--
--  * one thread per order; the two sides are the customer and the store admin(s)
--  * `sender_type` decides who is talking: 'customer' | 'admin'
--  * author name/avatar are snapshotted so the thread keeps rendering after a
--    profile edit or a deleted account
--  * messages are immutable: SELECT + INSERT policies only, no update/delete
--  * the 200-character limit lives here as a check constraint; the turn rule
--    ("a customer writes again only after an admin reply") is enforced in
--    src/app/api/orders/[id]/chat/route.ts, which is the only write path
-- -----------------------------------------------------------------------------

create table if not exists public.order_messages (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  sender_type       text not null check (sender_type in ('customer', 'admin')),
  sender_id         uuid,
  sender_name       text,
  sender_avatar_url text,
  message           text not null check (char_length(btrim(message)) between 1 and 200),
  created_at        timestamptz not null default now()
);

create index if not exists order_messages_order_created_idx on public.order_messages (order_id, created_at, id);

alter table public.order_messages enable row level security;

-- The order's owner and every admin can read the thread.
drop policy if exists "Order participants can read the thread" on public.order_messages;
create policy "Order participants can read the thread"
  on public.order_messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id
        and o.user_id = auth.uid()
    )
  );

-- A customer may only post to their own order, and only as 'customer';
-- 'admin' messages require the admin flag.
drop policy if exists "Order participants can post to the thread" on public.order_messages;
create policy "Order participants can post to the thread"
  on public.order_messages for insert
  with check (
    (
      sender_type = 'customer'
      and exists (
        select 1 from public.orders o
        where o.id = order_messages.order_id
          and o.user_id = auth.uid()
      )
    )
    or (sender_type = 'admin' and public.is_admin())
  );

-- =============================================================================
-- 18. Presence & receipts — heartbeat, visibility, delivered / seen
-- (migration 20261031000000_presence.sql)
-- =============================================================================

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

-- =============================================================================
-- 19. The narrow UPDATE policy + trigger behind ✓ / ✓✓
-- (migration 20261032000000_order_message_receipts.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  READ RECEIPTS — allow the *recipient* to stamp delivered_at / seen_at
--
--  Migration 17 made the thread immutable: SELECT + INSERT only. That also blocked
--  the read receipts added in 18 – the recipient's UPDATE matched no rows under RLS
--  and the ✓ / ✓✓ marks stayed grey. This opens exactly one door:
--
--    * the recipient may update the **other side's** messages of an order they take
--      part in (customer → admin messages, admin → customer messages);
--    * only `delivered_at` / `seen_at` may change, only into the future from null,
--      and nothing else about the row (a trigger enforces it, since RLS cannot
--      restrict columns);
--    * authors can never touch their own messages, and neither side can edit or
--      delete the text.
-- -----------------------------------------------------------------------------

drop policy if exists "Recipients can mark messages delivered and seen" on public.order_messages;
create policy "Recipients can mark messages delivered and seen"
  on public.order_messages for update
  using (
    (sender_type = 'admin' and exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    ))
    or (sender_type = 'customer' and public.is_admin())
  )
  with check (
    (sender_type = 'admin' and exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    ))
    or (sender_type = 'customer' and public.is_admin())
  );

comment on policy "Recipients can mark messages delivered and seen" on public.order_messages is
  'Read receipts only: the recipient stamps delivered_at / seen_at on the other side''s messages (see public.order_messages_receipts_only)';

/**
 * Keeps the threads immutable while the receipts above are written: anything other
 * than the two receipt columns – or rewriting a receipt that is already set – is
 * rejected. This is what lets the UPDATE policy stay so narrow.
 */
create or replace function public.order_messages_receipts_only()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.sender_type is distinct from old.sender_type
     or new.sender_id is distinct from old.sender_id
     or new.sender_name is distinct from old.sender_name
     or new.sender_avatar_url is distinct from old.sender_avatar_url
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Order messages are immutable – only the delivered / seen receipts can be set';
  end if;

  if old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
    raise exception 'The delivered receipt cannot be rewritten';
  end if;
  if old.seen_at is not null and new.seen_at is distinct from old.seen_at then
    raise exception 'The seen receipt cannot be rewritten';
  end if;
  if new.delivered_at is null and old.delivered_at is not null then
    raise exception 'The delivered receipt cannot be cleared';
  end if;
  if new.seen_at is null and old.seen_at is not null then
    raise exception 'The seen receipt cannot be cleared';
  end if;

  return new;
end;
$$;

drop trigger if exists order_messages_receipts_only on public.order_messages;
create trigger order_messages_receipts_only
  before update on public.order_messages
  for each row execute function public.order_messages_receipts_only();

-- =============================================================================
-- 20. Per-customer visibility + store_presence_for()
-- (migration 20261033000000_customer_visibility.sql)
-- =============================================================================

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

-- =============================================================================
-- 21. Notifications — the table, RLS and the six order / message triggers
-- (migration 20261034000000_notifications.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  NOTIFICATIONS — the bell in both headers, fed by the database itself
--
--  One row per (recipient, event). The rows are written by triggers, not by the
--  app, so every door into an order produces the same notification: the
--  checkout RPC, the admin form, the chat API, a SQL fix at 2 a.m.
--
--    new_order       → every admin, when a customer places an order
--    order_status    → the buyer, when the status of their order changes
--    order_cancelled → every admin, when an order is cancelled
--    payment         → every admin, when an order is marked paid
--    order_message   → the other side of an inquiry (customer ⇄ admin)
--
--  The title / body / href are stored resolved: the bell and the notifications
--  page render rows without a join, and a notification keeps working after the
--  order's title or the profile behind it changes. `href` is the exact page the
--  click should land on (`/orders/<id>` for a customer, `/nemesis/orders/<id>`
--  for an admin), so both headers share one component.
--
--  RLS: a recipient reads, marks read and deletes **their own** rows only. There
--  is no INSERT policy – the trigger functions (security definer) are the only
--  writers, so a customer can never forge a notification for somebody else.
--  The SSE endpoint (/api/notifications/stream) reads through this same RLS.
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text not null,
  order_id uuid references public.orders (id) on delete cascade,
  actor_name text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.notifications add constraint notifications_kind_check
    check (kind in ('new_order', 'order_status', 'order_cancelled', 'payment', 'order_message'));
exception
  when duplicate_object then null;
end $$;

-- the bell reads newest-first; the partial index is the unread count
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc, id desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_order_idx on public.notifications (order_id) where order_id is not null;

comment on table public.notifications is 'Per-recipient notifications, written by triggers on orders/order_messages; read through RLS';
comment on column public.notifications.href is 'Where a click lands: /orders/<id> for customers, /nemesis/orders/<id> for admins';

-- 1. RLS ---------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "Recipients read their notifications" on public.notifications;
create policy "Recipients read their notifications"
  on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "Recipients mark their notifications" on public.notifications;
create policy "Recipients mark their notifications"
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

drop policy if exists "Recipients delete their notifications" on public.notifications;
create policy "Recipients delete their notifications"
  on public.notifications for delete to authenticated
  using (recipient_id = auth.uid());

/**
 * The UPDATE policy above may only ever touch `read_at` – a notification is a
 * record of something that happened, not a draft. The trigger rejects every
 * other change (including moving a row to another recipient).
 */
create or replace function public.notifications_read_only()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.recipient_id, new.kind, new.title, new.body, new.href, new.order_id, new.actor_name, new.created_at)
     is distinct from
     (old.id, old.recipient_id, old.kind, old.title, old.body, old.href, old.order_id, old.actor_name, old.created_at)
  then
    raise exception 'Only the read state of a notification can change.';
  end if;
  return new;
end $$;

drop trigger if exists notifications_read_only on public.notifications;
create trigger notifications_read_only
  before update on public.notifications
  for each row execute function public.notifications_read_only();

-- 2. helpers -----------------------------------------------------------------
/** Every admin, except the one performing the action (no self-notifications). */
create or replace function public.notification_admins(p_actor uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.is_admin
    and p.id <> coalesce(p_actor, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

revoke all on function public.notification_admins(uuid) from public;

-- 3. a new order → every admin ------------------------------------------------
create or replace function public.orders_notify_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
  v_ref text;
begin
  select count(*) into v_items from public.order_items where order_id = new.id;
  v_ref := '#' || lpad(new.order_number::text, 4, '0');

  insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
  select
    a.id,
    'new_order',
    'New order ' || v_ref,
    coalesce(new.shipping_name, 'A customer') || ' placed an order · ' || v_items
      || case when v_items = 1 then ' item' else ' items' end,
    '/nemesis/orders/' || new.id,
    new.id,
    coalesce(new.shipping_name, 'Customer')
  from public.notification_admins(auth.uid()) as a(id);

  return new;
end $$;

drop trigger if exists orders_notify_new on public.orders;
create trigger orders_notify_new
  after insert on public.orders
  for each row execute function public.orders_notify_new();

-- 4. status / payment changes → the buyer and the admins -----------------------
create or replace function public.orders_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  v_ref := '#' || lpad(new.order_number::text, 4, '0');

  -- the customer: their order moved
  if new.status is distinct from old.status and new.user_id is not null then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    values (
      new.user_id,
      'order_status',
      'Order ' || v_ref || ' · ' || initcap(new.status::text),
      case new.status
        when 'processing' then 'Your order is being prepared.'
        when 'completed' then 'Your order has been completed. Thank you for shopping with us.'
        when 'cancelled' then 'Your order has been cancelled.'
        else 'Your order is now ' || new.status::text || '.'
      end,
      '/orders/' || new.id,
      new.id,
      'Admin'
    );
  end if;

  -- the admins: a cancellation is an alert worth a bell
  if new.status = 'cancelled' and new.status is distinct from old.status then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'order_cancelled', 'Order ' || v_ref || ' cancelled',
      coalesce(new.shipping_name, 'A customer') || ' – the order was cancelled.',
      '/nemesis/orders/' || new.id, new.id, coalesce(new.shipping_name, 'Customer')
    from public.notification_admins(auth.uid()) as a(id);
  end if;

  -- the admins: money arrived
  if new.payment_status = 'paid' and new.payment_status is distinct from old.payment_status then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'payment', 'Payment received · Order ' || v_ref,
      coalesce(new.shipping_name, 'A customer') || ' – marked as paid.',
      '/nemesis/orders/' || new.id, new.id, coalesce(new.shipping_name, 'Customer')
    from public.notification_admins(auth.uid()) as a(id);
  end if;

  return new;
end $$;

drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status
  after update of status, payment_status on public.orders
  for each row execute function public.orders_notify_status();

-- 5. an inquiry message → the other side --------------------------------------
create or replace function public.order_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_customer uuid;
  v_ref text;
begin
  select o.order_number, o.user_id into v_number, v_customer from public.orders o where o.id = new.order_id;
  v_ref := '#' || lpad(coalesce(v_number, 0)::text, 4, '0');

  if new.sender_type = 'customer' then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'order_message', 'New inquiry · Order ' || v_ref,
      left(new.message, 140), '/nemesis/orders/' || new.order_id, new.order_id,
      coalesce(new.sender_name, 'A customer')
    from public.notification_admins(new.sender_id) as a(id);
  elsif v_customer is not null and v_customer <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    values (v_customer, 'order_message', 'Admin replied · Order ' || v_ref,
      left(new.message, 140), '/orders/' || new.order_id, new.order_id, 'Admin');
  end if;

  return new;
end $$;

drop trigger if exists order_messages_notify on public.order_messages;
create trigger order_messages_notify
  after insert on public.order_messages
  for each row execute function public.order_messages_notify();

-- =============================================================================
-- 22. Category images — the picture behind the "Shop by category" tiles
-- (migration 20261035000000_category_images.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  CATEGORY IMAGES
--
--  A category can carry a picture that the storefront shows on its
--  "Shop by category" tiles (the grid falls back to a gradient icon otherwise).
--  The file itself lives in the Media Library; `image_url` mirrors its public
--  URL so public pages never have to join `media`. A plain external URL is
--  allowed too — `image_media_id` simply stays null then.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists image_url text,
  add column if not exists image_media_id uuid references public.media (id) on delete set null;

create index if not exists categories_image_media_id_idx on public.categories (image_media_id);

comment on column public.categories.image_url is 'Public URL of the tile image (Media Library file or an external URL).';
comment on column public.categories.image_media_id is 'Media Library file behind image_url; null for external URLs.';

-- =============================================================================
-- 23. Category icons — the icon an admin picks for a category
-- (migration 20261036000000_category_icons.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  CATEGORY ICONS
--
--  The icon a category shows on the "Shop by category" tiles when it has no
--  picture. The value is an id from src/lib/category-icons.ts (48 Lucide icons);
--  null means the default shopping bag.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon text;

comment on column public.categories.icon is 'Icon id picked in the admin (see src/lib/category-icons.ts); null = the default shopping bag.';

-- =============================================================================
-- 20261036000000_shipping_settings.sql
-- (migration 20261036000000_shipping_settings.sql)
-- =============================================================================

-- =============================================================================
--  Migration 26 – Configurable shipping options & flat shipping rate
--
--  Adds `shipping_enabled` and `shipping_rate_micros` to `public.site_settings`
--  so the admin can enable/disable shipping calculation and set the checkout
--  shipping rate under Settings → WooCommerce.
-- =============================================================================

alter table public.site_settings
  add column if not exists shipping_enabled     boolean not null default true,
  add column if not exists shipping_rate_micros bigint  not null default 5000000
    constraint site_settings_shipping_rate_micros_check check (shipping_rate_micros >= 0);

comment on column public.site_settings.shipping_enabled     is 'Whether shipping calculation is enabled at checkout';
comment on column public.site_settings.shipping_rate_micros is 'Flat checkout shipping rate in USD micro-dollars (1 USD = 1,000,000)';

create or replace function public.calculate_shipping(p_subtotal_micros bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := true;
  v_rate    bigint  := 5000000;
begin
  if coalesce(p_subtotal_micros, 0) <= 0 then
    return 0;
  end if;

  select coalesce(shipping_enabled, true),
         coalesce(shipping_rate_micros, 5000000)
    into v_enabled, v_rate
    from public.site_settings
   where id = 1;

  if not coalesce(v_enabled, true) then
    return 0;
  end if;

  return greatest(coalesce(v_rate, 0), 0);
end $$;

comment on function public.calculate_shipping(bigint) is 'Checkout shipping in USD micro-dollars from site_settings (0 when shipping_enabled is false)';

-- =============================================================================
-- 24. Category icon colour — the fill behind that icon
-- (migration 20261037000000_category_icon_color.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  CATEGORY ICON COLOUR
--
--  The fill behind a category's icon on the "Shop by category" tiles. A plain
--  `#rrggbb` value picked in the admin; null means the theme's primary colour.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_icon_color_check'
  ) then
    alter table public.categories
      add constraint categories_icon_color_check
      check (icon_color is null or icon_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end
$$;

comment on column public.categories.icon_color is 'Icon fill (#rrggbb) picked in the admin; null = the theme primary colour.';

-- =============================================================================
-- 20261037000000_footer_text.sql
-- (migration 20261037000000_footer_text.sql)
-- =============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  Settings → General: Footer Text
--
--  Adds `footer_text` to `public.site_settings` so the secondary copyright
--  text in the storefront footer ("Built with Next.js, Supabase and shadcn/ui.")
--  can be edited from Settings → General.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.site_settings
  add column if not exists footer_text text default 'Built with Next.js, Supabase and shadcn/ui.';

comment on column public.site_settings.footer_text is 'Footer copyright secondary text shown after "© {year} {store_name}."';

-- =============================================================================
-- 25. Category "Remove icon" — picture-only tiles
-- (migration 20261038000000_category_no_icon.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  CATEGORY "NO ICON"
--
--  A category that has a picture normally shows an icon badge on top of it
--  (the default shopping bag when the admin never picked one). `icon_disabled`
--  is the admin's "Remove icon" answer: the tile uses the picture alone.
--  Only meaningful when the category has an image – without one the tile still
--  needs an icon, so the shopping bag stays.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon_disabled boolean not null default false;

comment on column public.categories.icon_disabled is 'True when the admin removed the icon of a category that has a picture – the tile shows the image alone. Ignored without an image.';

-- =============================================================================
-- 20261038000000_home_hero.sql
-- (migration 20261038000000_home_hero.sql)
-- =============================================================================

-- Migration: dynamic Home page Hero section settings (UI → Home page)
alter table public.site_settings
  add column if not exists home_show_hero boolean not null default true,
  add column if not exists home_hero_badge text default 'New season',
  add column if not exists home_hero_title text,
  add column if not exists home_hero_subtitle text,
  add column if not exists home_hero_primary_cta_text text default 'Shop now',
  add column if not exists home_hero_primary_cta_href text default '/shop',
  add column if not exists home_hero_secondary_cta_text text default 'Explore electronics',
  add column if not exists home_hero_secondary_cta_href text default '/shop?category=electronics';

-- =============================================================================
-- 20261039000000_product_brand.sql
-- (migration 20261039000000_product_brand.sql)
-- =============================================================================

-- Migration: add `brand` & `features` columns to `products`, and homepage category showcase columns to `site_settings`
alter table public.products
  add column if not exists brand text,
  add column if not exists features text;

alter table public.site_settings
  add column if not exists home_show_category_sections boolean not null default true,
  add column if not exists home_category_default_layout text not null default 'grid',
  add column if not exists home_category_banner_style text not null default 'soft',
  add column if not exists home_category_sections jsonb not null default '[]'::jsonb;

-- =============================================================================
-- 20261040000000_menu_dropdown.sql
-- (migration 20261040000000_menu_dropdown.sql)
-- =============================================================================

-- =============================================================================
--  HEADER DROPDOWN MENUS (admin dashboard → UI → Menu → Header menu)
--  Idempotent – safe to run more than once.
-- =============================================================================

alter table public.menu_items
  add column if not exists parent_id uuid references public.menu_items (id) on delete set null;

create index if not exists menu_items_parent_idx on public.menu_items (parent_id);

comment on column public.menu_items.parent_id is 'Optional parent menu item id (header menu dropdown items). Null for top-level items and footer menu items.';

-- =============================================================================
-- 20261041000000_product_quick_checkout.sql
-- (migration 20261041000000_product_quick_checkout.sql)
-- =============================================================================

-- ============================================================================
-- Woo Solution — Migration 27: Product-level Quick Checkout & Quantity Attribute
-- ============================================================================

alter table public.products
  add column if not exists quick_checkout boolean not null default false;

comment on column public.products.quick_checkout is
  'Whether the product displays the Quick Checkout button on the storefront (disabled by default).';

alter table public.product_attributes
  add column if not exists is_quantity boolean not null default false;

comment on column public.product_attributes.is_quantity is
  'Marks this attribute as the Quantity tier axis for Quick Checkout.';

-- =============================================================================
-- 20261042000000_payment_settings.sql
-- (migration 20261042000000_payment_settings.sql)
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- Migration: WooCommerce Payment Settings (Cryptocurrency Gateway & Cash on Delivery)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.site_settings
  add column if not exists payment_cod_enabled boolean not null default true,
  add column if not exists payment_crypto_enabled boolean not null default true,
  add column if not exists payment_crypto_protocols jsonb not null default '[]'::jsonb;

comment on column public.site_settings.payment_cod_enabled is
  'Whether Cash on Delivery (COD) is enabled as a checkout payment option.';

comment on column public.site_settings.payment_crypto_enabled is
  'Whether the Cryptocurrency payment gateway is enabled.';

comment on column public.site_settings.payment_crypto_protocols is
  'Configured cryptocurrency deposit wallet protocols (code, name, network, address, badge, enabled).';

-- =============================================================================
-- 20261043000000_order_payment_details.sql
-- (migration 20261043000000_order_payment_details.sql)
-- =============================================================================

-- =============================================================================
--  Migration: Order Crypto Payment Details
--  Adds optional crypto payment columns to `public.orders` so Admin can inspect
--  the selected protocol, network, deposit address, and customer Transaction ID (TXID).
-- =============================================================================

alter table public.orders
  add column if not exists payment_protocol text,
  add column if not exists payment_network  text,
  add column if not exists payment_address  text,
  add column if not exists payment_tx_id    text;

comment on column public.orders.payment_protocol is 'Selected crypto wallet protocol name/code (e.g. Tether USDT (USDT))';
comment on column public.orders.payment_network  is 'Selected blockchain network (e.g. TRON TRC20, Bitcoin Mainnet)';
comment on column public.orders.payment_address  is 'Store deposit address shown to customer at checkout';
comment on column public.orders.payment_tx_id    is 'Customer-submitted Transaction ID / Hash (TXID) for Admin verification';

-- =============================================================================
-- 20261044000000_fix_order_notification_item_count.sql
-- (migration 20261044000000_fix_order_notification_item_count.sql)
-- =============================================================================

-- =============================================================================
--  Migration: Fix `new_order` Notification Item Count
--  Because `place_order` inserts `public.orders` before inserting `public.order_items`,
--  an `after insert on public.orders` trigger saw 0 items. This migration:
--    1. Allows internal updates to `notifications.body` when syncing item counts.
--    2. Adds an `after insert on public.order_items` trigger that updates the
--       `new_order` notification body with the total quantity (`sum(quantity)`).
--    3. Backfills any existing `new_order` notifications that say "0 items".
-- =============================================================================

create or replace function public.notifications_read_only()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.recipient_id, new.kind, new.title, new.href, new.order_id, new.actor_name, new.created_at)
     is distinct from
     (old.id, old.recipient_id, old.kind, old.title, old.href, old.order_id, old.actor_name, old.created_at)
  then
    raise exception 'Only the read state of a notification can change.';
  end if;

  if new.body is distinct from old.body and old.kind <> 'new_order' then
    raise exception 'Only the read state of a notification can change.';
  end if;

  return new;
end $$;

create or replace function public.orders_notify_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
  v_ref text;
begin
  select coalesce(sum(quantity), 0)::integer
    into v_items
    from public.order_items
   where order_id = new.id;

  v_ref := '#' || lpad(new.order_number::text, 4, '0');

  insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
  select
    a.id,
    'new_order',
    'New order ' || v_ref,
    coalesce(new.shipping_name, 'A customer') || ' placed an order · ' || v_items
      || case when v_items = 1 then ' item' else ' items' end,
    '/nemesis/orders/' || new.id,
    new.id,
    coalesce(new.shipping_name, 'Customer')
  from public.notification_admins(auth.uid()) as a(id);

  return new;
end $$;

create or replace function public.order_items_sync_new_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
  v_name  text;
begin
  select coalesce(sum(quantity), 0)::integer
    into v_items
    from public.order_items
   where order_id = new.order_id;

  select coalesce(shipping_name, 'A customer')
    into v_name
    from public.orders
   where id = new.order_id;

  update public.notifications
     set body = coalesce(v_name, 'A customer') || ' placed an order · ' || v_items
       || case when v_items = 1 then ' item' else ' items' end
   where order_id = new.order_id
     and kind = 'new_order';

  return new;
end $$;

drop trigger if exists order_items_sync_notification on public.order_items;
create trigger order_items_sync_notification
  after insert on public.order_items
  for each row execute function public.order_items_sync_new_order_notification();

-- Backfill existing `new_order` notifications that say "0 items"
update public.notifications n
   set body = regexp_replace(
     n.body,
     '\m0 items\M',
     sub.total_qty::text || case when sub.total_qty = 1 then ' item' else ' items' end
   )
  from (
    select order_id, coalesce(sum(quantity), 0)::integer as total_qty
      from public.order_items
     group by order_id
  ) sub
 where n.kind = 'new_order'
   and n.order_id = sub.order_id
   and sub.total_qty > 0
   and n.body ~ '\m0 items\M';

-- =============================================================================
-- 20261045000000_auto_read_active_chat_notifications.sql
-- (migration 20261045000000_auto_read_active_chat_notifications.sql)
-- =============================================================================

-- =============================================================================
--  Migration: Auto-Read Active Order Chat Notifications
--  Prevents unread notification buildup when a customer or admin is actively
--  viewing or replying in an order's chat thread, while keeping notifications
--  for all other orders untouched:
--    1. Replying to an order thread marks the sender's unread `order_message`
--       notifications for that order as read.
--    2. Seeing a message (`seen_at` stamped on `order_messages`) marks the
--       recipient's unread `order_message` notifications for that order as read.
-- =============================================================================

create or replace function public.order_messages_auto_read_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. On INSERT: the person sending a reply has read the conversation for this order
  if tg_op = 'INSERT' and new.sender_id is not null then
    update public.notifications
       set read_at = coalesce(new.created_at, now())
     where order_id = new.order_id
       and kind = 'order_message'
       and recipient_id = new.sender_id
       and read_at is null;
    return new;
  end if;

  -- 2. On UPDATE of seen_at: the recipient side actively viewed this order's chat
  if tg_op = 'UPDATE' and new.seen_at is not null and old.seen_at is null then
    if new.sender_type = 'customer' then
      -- An admin saw the customer's message on this order
      update public.notifications n
         set read_at = new.seen_at
        from public.profiles p
       where n.order_id = new.order_id
         and n.kind = 'order_message'
         and n.recipient_id = p.id
         and p.is_admin = true
         and n.read_at is null;
    elsif new.sender_type = 'admin' then
      -- The customer saw the admin's message on this order
      update public.notifications n
         set read_at = new.seen_at
        from public.orders o
       where o.id = new.order_id
         and n.order_id = new.order_id
         and n.kind = 'order_message'
         and n.recipient_id = o.user_id
         and n.read_at is null;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists order_messages_auto_read_notifications_insert on public.order_messages;
create trigger order_messages_auto_read_notifications_insert
  after insert on public.order_messages
  for each row execute function public.order_messages_auto_read_notifications();

drop trigger if exists order_messages_auto_read_notifications_seen on public.order_messages;
create trigger order_messages_auto_read_notifications_seen
  after update of seen_at on public.order_messages
  for each row execute function public.order_messages_auto_read_notifications();

-- =============================================================================
-- 20261046000000_plisio_payment.sql
-- (migration 20261046000000_plisio_payment.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 29. Plisio Automated Cryptocurrency Payment Gateway
--     Adds `payment_plisio_enabled` and `payment_plisio_secret_key` to
--     `public.site_settings`, plus SECURITY DEFINER helpers so Plisio invoice
--     creation and webhook/auto-verification can atomically update orders to
--     `payment_status = 'paid'` and `status = 'processing'`.
-- -----------------------------------------------------------------------------

alter table public.site_settings
  add column if not exists payment_plisio_enabled boolean not null default false,
  add column if not exists payment_plisio_test_mode boolean not null default false,
  add column if not exists payment_plisio_secret_key text,
  add column if not exists payment_plisio_currencies jsonb not null default '[]'::jsonb;

create or replace function public.get_plisio_order_state(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, user_id, order_number, status, payment_status, total_micros, customer_email, notes
    into v_row
    from public.orders
   where id = p_order_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'order_number', v_row.order_number,
    'status', v_row.status,
    'payment_status', v_row.payment_status,
    'total_micros', v_row.total_micros,
    'customer_email', v_row.customer_email,
    'notes', v_row.notes
  );
end;
$$;

create or replace function public.sync_plisio_order_invoice(
  p_order_id uuid,
  p_notes text,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_order_id;

  return public.get_plisio_order_state(p_order_id);
end;
$$;

create or replace function public.confirm_plisio_order_payment(
  p_order_id uuid,
  p_notes text default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set payment_status = 'paid',
         status = case when status = 'pending' then 'processing' else status end,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_order_id;

  return public.get_plisio_order_state(p_order_id);
end;
$$;

grant execute on function public.get_plisio_order_state(uuid) to anon, authenticated;
grant execute on function public.sync_plisio_order_invoice(uuid, text, text) to anon, authenticated;
grant execute on function public.confirm_plisio_order_payment(uuid, text, text) to anon, authenticated;

-- =============================================================================
-- 20261047000000_order_chat_attachments.sql
-- (migration 20261047000000_order_chat_attachments.sql)
-- =============================================================================

-- =============================================================================
--  Migration: Order Chat File Attachments (Admin → Customer)
--  Allows store admins to send any type of file attachment in the per-order
--  inquiry chat (`public.order_messages`), and allows customers to view and
--  download those attachments from their order page.
-- =============================================================================

-- 1. Attachment columns on `public.order_messages` ----------------------------
alter table public.order_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint check (attachment_size is null or attachment_size >= 0);

-- 2. Allow empty text caption when an admin sends an attachment, and enforce
--    that only admins can attach files. ---------------------------------------
alter table public.order_messages
  drop constraint if exists order_messages_message_check;

alter table public.order_messages
  add constraint order_messages_message_check
  check (
    char_length(btrim(message)) <= 200
    and (
      char_length(btrim(message)) >= 1
      or (sender_type = 'admin' and attachment_url is not null)
    )
  );

alter table public.order_messages
  drop constraint if exists order_messages_attachment_admin_only_check;

alter table public.order_messages
  add constraint order_messages_attachment_admin_only_check
  check (attachment_url is null or sender_type = 'admin');

-- 3. Keep attachment fields immutable in the read-receipt UPDATE trigger ------
create or replace function public.order_messages_receipts_only()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.sender_type is distinct from old.sender_type
     or new.sender_id is distinct from old.sender_id
     or new.sender_name is distinct from old.sender_name
     or new.sender_avatar_url is distinct from old.sender_avatar_url
     or new.message is distinct from old.message
     or new.attachment_url is distinct from old.attachment_url
     or new.attachment_name is distinct from old.attachment_name
     or new.attachment_type is distinct from old.attachment_type
     or new.attachment_size is distinct from old.attachment_size
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Order messages are immutable – only the delivered / seen receipts can be set';
  end if;

  if old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
    raise exception 'The delivered receipt cannot be rewritten';
  end if;
  if old.seen_at is not null and new.seen_at is distinct from old.seen_at then
    raise exception 'The seen receipt cannot be rewritten';
  end if;
  if new.delivered_at is null and old.delivered_at is not null then
    raise exception 'The delivered receipt cannot be cleared';
  end if;
  if new.seen_at is null and old.seen_at is not null then
    raise exception 'The seen receipt cannot be cleared';
  end if;

  return new;
end;
$$;

-- 4. Include attachment filenames in customer notifications -------------------
create or replace function public.order_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_customer uuid;
  v_ref text;
  v_body text;
begin
  select o.order_number, o.user_id into v_number, v_customer from public.orders o where o.id = new.order_id;
  v_ref := '#' || lpad(coalesce(v_number, 0)::text, 4, '0');

  if new.attachment_name is not null and btrim(new.message) <> '' then
    v_body := left('📎 ' || new.attachment_name || ' · ' || btrim(new.message), 140);
  elsif new.attachment_name is not null then
    v_body := left('📎 Sent an attachment: ' || new.attachment_name, 140);
  else
    v_body := left(new.message, 140);
  end if;

  if new.sender_type = 'customer' then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'order_message', 'New inquiry · Order ' || v_ref,
      v_body, '/nemesis/orders/' || new.order_id, new.order_id,
      coalesce(new.sender_name, 'A customer')
    from public.notification_admins(new.sender_id) as a(id);
  elsif v_customer is not null and v_customer <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    values (v_customer, 'order_message', 'Admin replied · Order ' || v_ref,
      v_body, '/orders/' || new.order_id, new.order_id, 'Admin');
  end if;

  return new;
end $$;

-- 5. Ensure "media" bucket accepts any file type up to 50 MB for attachments --
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 52428800, null)
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit),
            allowed_mime_types = null
    $sql$;
  end if;
end
$$;

-- =============================================================================
-- 26. Blog posts — independent editorial posts, shared tags, SEO, media tracking and RLS
-- (migration 20261048000000_blog_posts.sql)
-- =============================================================================

-- =============================================================================
-- BLOG POSTS — separate editorial posts with the same block content + SEO model
-- as CMS pages. Tags are shared; relations and content-media tracking are not.
-- =============================================================================

create table if not exists public.blog_posts (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 200),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  content            text not null default '',
  excerpt            text,
  featured_image_id  uuid references public.media (id) on delete set null,
  featured_image_url text check (char_length(featured_image_url) <= 2000),
  status             text not null default 'draft' check (status in ('draft', 'published')),
  seo_title          text check (char_length(seo_title) <= 120),
  seo_description    text check (char_length(seo_description) <= 320),
  canonical_url      text check (char_length(canonical_url) <= 500),
  robots_index       boolean not null default true,
  robots_follow      boolean not null default true,
  og_title           text check (char_length(og_title) <= 120),
  og_description     text check (char_length(og_description) <= 320),
  og_image_id        uuid references public.media (id) on delete set null,
  og_image_url       text check (char_length(og_image_url) <= 2000),
  author_id          uuid references public.profiles (id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists blog_posts_status_idx on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_updated_idx on public.blog_posts (updated_at desc);
create index if not exists blog_posts_title_idx on public.blog_posts (lower(title));
create index if not exists blog_posts_featured_idx on public.blog_posts (featured_image_id);
create index if not exists blog_posts_og_image_idx on public.blog_posts (og_image_id);

drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at before update on public.blog_posts
  for each row execute function public.set_updated_at();

create table if not exists public.blog_post_tags (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  position integer not null default 0,
  primary key (post_id, tag_id)
);
create index if not exists blog_post_tags_tag_idx on public.blog_post_tags (tag_id);

create table if not exists public.blog_post_media (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  primary key (post_id, media_id)
);
create index if not exists blog_post_media_media_idx on public.blog_post_media (media_id);

alter table public.blog_posts enable row level security;
alter table public.blog_post_tags enable row level security;
alter table public.blog_post_media enable row level security;

drop policy if exists "Published blog posts are viewable by everyone" on public.blog_posts;
create policy "Published blog posts are viewable by everyone" on public.blog_posts
  for select using (status = 'published' or public.is_admin());
drop policy if exists "Admins can manage blog posts" on public.blog_posts;
create policy "Admins can manage blog posts" on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Blog post tags are viewable by everyone" on public.blog_post_tags;
create policy "Blog post tags are viewable by everyone" on public.blog_post_tags
  for select using (true);
drop policy if exists "Admins can manage blog post tags" on public.blog_post_tags;
create policy "Admins can manage blog post tags" on public.blog_post_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can manage blog post media" on public.blog_post_media;
create policy "Admins can manage blog post media" on public.blog_post_media
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Preserve existing product, site-setting, page, and variation usage tracking;
-- add featured/share/content references for blog posts.
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql stable set search_path = public as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text from public.products p where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text from public.product_media pm join public.products p on p.id = pm.product_id where pm.media_id = any (p_ids)
  union all
  select v.image_media_id, p.id, p.name, p.slug, 'variation'::text from public.product_variations v join public.products p on p.id = v.product_id where v.image_media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text from public.site_settings s where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text from public.site_settings s where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text from public.pages pg where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text from public.pages pg where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text from public.page_media pm join public.pages pg on pg.id = pm.page_id where pm.media_id = any (p_ids)
  union all
  select bp.featured_image_id, bp.id, bp.title, bp.slug, 'post_image'::text from public.blog_posts bp where bp.featured_image_id = any (p_ids)
  union all
  select bp.og_image_id, bp.id, bp.title, bp.slug, 'post_share_image'::text from public.blog_posts bp where bp.og_image_id = any (p_ids)
  union all
  select bpm.media_id, bp.id, bp.title, bp.slug, 'post_content'::text from public.blog_post_media bpm join public.blog_posts bp on bp.id = bpm.post_id where bpm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- Make the new blog discoverable in the storefront navigation, without
-- duplicating links if this migration is re-applied.
insert into public.menu_items (location, kind, title, url, sort_order)
select location, 'custom', 'Blog', '/blog', coalesce((select max(sort_order) + 1 from public.menu_items m where m.location = links.location), 0)
from (values ('header'::text), ('footer'::text)) as links(location)
where not exists (select 1 from public.menu_items m where m.location = links.location and m.url = '/blog');

-- =============================================================================
-- 20261049000000_ai_settings.sql
-- (migration 20261049000000_ai_settings.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 32. Nemesis AI Settings & Provider Key Vault (Admin-Only)
--     Stores AI provider configuration, model routing, token-budget mode, brand
--     voice instructions, and per-provider API keys for the /nemesis AI Agent.
--     Locked strictly behind `public.is_admin()` RLS so API keys are never
--     exposed to `anon` or regular storefront customers.
-- -----------------------------------------------------------------------------

create table if not exists public.ai_settings (
  id                      integer primary key default 1 check (id = 1),
  enabled                 boolean not null default false,
  provider                text not null default 'groq',
  primary_model           text not null default 'openai/gpt-oss-120b',
  fallback_model          text default 'openai/gpt-oss-20b',
  custom_base_url         text,
  ollama_mode             text not null default 'browser'
                          check (ollama_mode in ('browser', 'tunnel')),
  ollama_base_url         text not null default 'http://localhost:11434',
  ollama_num_ctx          integer not null default 4096
                          check (ollama_num_ctx >= 2048 and ollama_num_ctx <= 131072),
  ollama_disable_thinking boolean not null default true,
  token_budget_mode       text not null default 'economy'
                          check (token_budget_mode in ('economy', 'standard', 'high')),
  reasoning_effort        text not null default 'low'
                          check (reasoning_effort in ('low', 'medium', 'high')),
  temperature             numeric(3, 2) not null default 0.20
                          check (temperature >= 0 and temperature <= 2),
  vision_enabled          boolean not null default false,
  require_confirmation    boolean not null default true,
  brand_tone              text not null default 'modern',
  default_language        text not null default 'English',
  system_instructions     text,
  api_keys                jsonb not null default '{}'::jsonb,
  updated_at              timestamptz not null default now()
);

alter table public.ai_settings enable row level security;

drop policy if exists "ai_settings_admin_all" on public.ai_settings;
create policy "ai_settings_admin_all"
  on public.ai_settings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.ai_settings (id)
values (1)
on conflict (id) do nothing;

-- =============================================================================
-- 20261050000000_product_editor.sql
-- (migration 20261050000000_product_editor.sql)
-- =============================================================================

-- Product editor: private costs, rich content, per-product stock and search/social metadata.
alter table public.products
  add column content text not null default '',
  add column manage_stock boolean,
  add column seo_title text,
  add column seo_description text,
  add column canonical_url text,
  add column robots_index boolean not null default true,
  add column robots_follow boolean not null default true,
  add column og_title text,
  add column og_description text,
  add column og_image_id uuid references public.media(id) on delete set null,
  add column og_image_url text;
update public.products set manage_stock = public.stock_managed() where manage_stock is null;
alter table public.products alter column manage_stock set not null;

-- The global setting supplies the initial value only; each product can override it.
create or replace function public.initialize_product_stock_management()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.manage_stock is null then new.manage_stock := public.stock_managed(); end if;
  return new;
end $$;
create trigger products_initialize_stock before insert on public.products
for each row execute function public.initialize_product_stock_management();

-- Costs must NOT be columns on public-readable products, even if omitted from the UI.
create table public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost_price_micros bigint not null check (cost_price_micros >= 0 and cost_price_micros <= 9007199254740991),
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
create policy product_costs_admin_all on public.product_costs for all to authenticated
using (public.is_admin()) with check (public.is_admin());
revoke all on public.product_costs from anon;
grant select, insert, update, delete on public.product_costs to authenticated;
grant all on public.product_costs to service_role;
create trigger product_costs_updated_at before update on public.product_costs
for each row execute function public.set_updated_at();

create table public.product_content_media (
  product_id uuid not null references public.products(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete restrict,
  primary key(product_id, media_id)
);
create index product_content_media_media_id_idx on public.product_content_media(media_id);
alter table public.product_content_media enable row level security;
create policy product_content_media_admin on public.product_content_media for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy product_content_media_read on public.product_content_media for select to anon, authenticated
using (exists(select 1 from public.products p where p.id = product_id and p.is_active));
grant select on public.product_content_media to anon;
grant select, insert, update, delete on public.product_content_media to authenticated;
grant all on public.product_content_media to service_role;

-- Snapshot whether quantities were actually deducted. Later stock-setting changes must
-- not manufacture stock on cancellation, or deduct untracked historical purchases.
alter table public.order_items add column stock_deducted boolean;
update public.order_items oi set stock_deducted = coalesce(
  (select p.manage_stock from public.products p where p.id = oi.product_id), public.stock_managed());
alter table public.order_items alter column stock_deducted set not null;
alter table public.order_items alter column stock_deducted set default true;

-- Preserve the existing checkout implementation while changing only stock ownership and
-- adding the line snapshot. Assert expected fragments so schema drift fails atomically.
do $migration$
declare definition text;
begin
  definition := replace(pg_get_functiondef('public.place_order(jsonb,jsonb)'::regprocedure), E'\r\n', E'\n');
  if position('v_managed     boolean := public.stock_managed();' in definition) = 0
    or position('v_price, v_qty, v_variation.id, v_label' in definition) = 0 then
    raise exception 'Unexpected place_order definition; review checkout migration before applying.';
  end if;
  definition := replace(definition, 'v_managed     boolean := public.stock_managed();', 'v_managed     boolean;');
  definition := replace(definition, '    v_variation_id :=', E'    v_managed := v_product.manage_stock;\n    v_variation_id :=');
  definition := replace(definition, '    v_label        := null;', E'    v_label        := null;\n    if v_product.type = ''variable'' and v_variation_id is null then\n      raise exception ''Choose an available variation for %.'', v_product.name;\n    end if;\n    if v_product.type <> ''variable'' and v_variation_id is not null then\n      raise exception ''This product does not have variations.'';\n    end if;');
  definition := replace(definition, 'unit_price_micros, quantity, variation_id, variation_label', 'unit_price_micros, quantity, variation_id, variation_label, stock_deducted');
  definition := replace(definition, 'v_price, v_qty, v_variation.id, v_label', 'v_price, v_qty, v_variation.id, v_label, v_managed');
  definition := replace(definition, E'image_url, unit_price_micros, quantity\n', E'image_url, unit_price_micros, quantity, stock_deducted\n');
  definition := replace(definition, E'v_product.image_url, v_price, v_qty\n', E'v_product.image_url, v_price, v_qty, v_managed\n');
  if position('quantity, stock_deducted' in definition) = 0 or position('v_managed := v_product.manage_stock' in definition) = 0 then
    raise exception 'Checkout stock snapshot patch failed.';
  end if;
  execute definition;
end $migration$;

create or replace function public.sync_stock_on_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare direction integer;
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' then direction := 1;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then direction := -1;
  else return new;
  end if;
  update public.product_variations v set stock = v.stock + direction * lines.quantity
  from (select variation_id, sum(quantity)::integer quantity from public.order_items
        where order_id = new.id and stock_deducted and variation_id is not null group by variation_id) lines
  where v.id = lines.variation_id;
  update public.products p set stock = p.stock + direction * lines.quantity
  from (select product_id, sum(quantity)::integer quantity from public.order_items
        where order_id = new.id and stock_deducted and variation_id is null group by product_id) lines
  where p.id = lines.product_id;
  return new;
end $$;

create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql stable set search_path = public as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text from public.products p where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text from public.product_media pm join public.products p on p.id = pm.product_id where pm.media_id = any (p_ids)
  union all
  select v.image_media_id, p.id, p.name, p.slug, 'variation'::text from public.product_variations v join public.products p on p.id = v.product_id where v.image_media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text from public.site_settings s where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text from public.site_settings s where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text from public.pages pg where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text from public.pages pg where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text from public.page_media pm join public.pages pg on pg.id = pm.page_id where pm.media_id = any (p_ids)
  union all
  select bp.featured_image_id, bp.id, bp.title, bp.slug, 'post_image'::text from public.blog_posts bp where bp.featured_image_id = any (p_ids)
  union all
  select bp.og_image_id, bp.id, bp.title, bp.slug, 'post_share_image'::text from public.blog_posts bp where bp.og_image_id = any (p_ids)
  union all
  select bpm.media_id, bp.id, bp.title, bp.slug, 'post_content'::text from public.blog_post_media bpm join public.blog_posts bp on bp.id = bpm.post_id where bpm.media_id = any (p_ids)
  union all
  select pcm.media_id, p.id, p.name, p.slug, 'product_content'::text from public.product_content_media pcm join public.products p on p.id = pcm.product_id where pcm.media_id = any(p_ids)
  union all
  select p.og_image_id, p.id, p.name, p.slug, 'product_share_image'::text from public.products p where p.og_image_id = any(p_ids);
$$;

-- =============================================================================
-- 20261051000000_order_intelligence.sql
-- (migration 20261051000000_order_intelligence.sql)
-- =============================================================================

-- Order Intelligence: private operational history, approved actions, bounded admin RPCs.
-- Amounts remain base USD micros. Unknown historical timestamps are never fabricated.
alter table public.orders
  add column fulfillment_status text not null default 'unknown' check (fulfillment_status in ('unknown','unfulfilled','packed','shipped','delivered')),
  add column shipping_status text not null default 'unknown' check (shipping_status in ('unknown','pending','in_transit','delayed','delivered')),
  add column tracking_number text,
  add column tracking_url text,
  add column shipping_carrier text,
  add column paid_at timestamptz,
  add column fulfilled_at timestamptz,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column fulfillment_due_at timestamptz,
  add column expected_delivery_at timestamptz,
  add column refund_requested_at timestamptz,
  add column refund_request_status text not null default 'none' check (refund_request_status in ('none','requested','completed'));
alter table public.orders alter column fulfillment_status set default 'unfulfilled';
alter table public.orders alter column shipping_status set default 'pending';

create index orders_intelligence_created_idx on public.orders(created_at desc,id desc);
create index orders_intelligence_status_created_idx on public.orders(status,created_at desc);
create index orders_intelligence_payment_created_idx on public.orders(payment_status,created_at desc);
create index orders_intelligence_email_created_idx on public.orders(lower(customer_email),created_at desc);
create index orders_intelligence_fulfillment_idx on public.orders(fulfillment_status,created_at desc);
create index order_items_intelligence_product_idx on public.order_items(product_id,order_id);

create table public.order_operations_log (
 id uuid primary key default gen_random_uuid(),
 order_id uuid references public.orders(id) on delete set null,
 order_number bigint,
 actor_id uuid references auth.users(id) on delete set null,
 event text not null,
 message text not null,
 success boolean not null default true,
 created_at timestamptz not null default now()
);
create index order_operations_log_order_idx on public.order_operations_log(order_id,created_at desc);
alter table public.order_operations_log enable row level security;
create policy "Admin reads order operations" on public.order_operations_log for select to authenticated using(public.is_admin());
revoke all on public.order_operations_log from anon, authenticated;
grant select on public.order_operations_log to authenticated;

create table public.order_action_previews (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 order_version timestamptz not null,
 action text not null,
 payload jsonb not null,
 expires_at timestamptz not null default now() + interval '30 minutes',
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index order_action_previews_actor_expiry_idx on public.order_action_previews(actor_id,expires_at);
alter table public.order_action_previews enable row level security;
revoke all on public.order_action_previews from anon, authenticated;
-- Only guarded RPCs access previews. Client-supplied plan contents are never authoritative.

create or replace function public.capture_order_intelligence_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op = 'INSERT' then
   insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'created','Order created');
 else
   if new.status is distinct from old.status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'status',old.status::text || ' → ' || new.status::text);
   end if;
   if new.payment_status is distinct from old.payment_status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'payment',old.payment_status || ' → ' || new.payment_status);
   end if;
   if new.fulfillment_status is distinct from old.fulfillment_status or new.shipping_status is distinct from old.shipping_status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'fulfillment',new.fulfillment_status || ' / ' || new.shipping_status);
   end if;
 end if;
 return new;
end $$;
create trigger orders_intelligence_events after insert or update on public.orders for each row execute function public.capture_order_intelligence_event();

create or replace function public.stamp_order_intelligence_payment() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if tg_op='INSERT' or new.payment_status is distinct from old.payment_status then
  if new.payment_status='paid' then new.paid_at := coalesce(new.paid_at,now()); end if;
  if new.payment_status='refunded' then new.refund_request_status := 'completed'; end if;
 end if;
 return new;
end $$;
create trigger orders_intelligence_payment before insert or update on public.orders for each row execute function public.stamp_order_intelligence_payment();

-- Shared, parameterized filter. No raw SQL from the model, no wildcard interpolation.
create or replace function public.nemesis_order_scope(p jsonb) returns setof public.orders
language sql stable as $$
 select o.* from public.orders o where
   (nullif(p->>'id','') is null or o.id = (p->>'id')::uuid)
   and (nullif(p->>'orderNumber','') is null or o.order_number = (p->>'orderNumber')::bigint)
   and (nullif(p->>'customerId','') is null or o.user_id = (p->>'customerId')::uuid)
   and (nullif(p->>'customerOrderId','') is null or exists(select 1 from public.orders anchor where anchor.id=(p->>'customerOrderId')::uuid and (case when anchor.user_id is not null then o.user_id=anchor.user_id when nullif(anchor.customer_email,'') is not null then o.user_id is null and lower(o.customer_email)=lower(anchor.customer_email) else o.id=anchor.id end)))
   and (nullif(p->>'email','') is null or lower(o.customer_email) = lower(p->>'email'))
   and (nullif(p->>'customer','') is null or position(lower(p->>'customer') in lower(o.shipping_name)) > 0 or position(lower(p->>'customer') in lower(coalesce(o.customer_email,''))) > 0)
   and (nullif(p->>'status','') is null or o.status::text = p->>'status')
   and (nullif(p->>'paymentStatus','') is null or o.payment_status = p->>'paymentStatus')
   and (nullif(p->>'fulfillmentStatus','') is null or o.fulfillment_status = p->>'fulfillmentStatus')
   and (nullif(p->>'shippingStatus','') is null or o.shipping_status = p->>'shippingStatus')
   and (nullif(p->>'from','') is null or o.created_at >= (p->>'from')::timestamptz)
   and (nullif(p->>'to','') is null or o.created_at < (p->>'to')::timestamptz)
   and (nullif(p->>'minValueMicros','') is null or o.total_micros >= (p->>'minValueMicros')::bigint)
   and (nullif(p->>'maxValueMicros','') is null or o.total_micros <= (p->>'maxValueMicros')::bigint)
   and (nullif(p->>'product','') is null or exists(select 1 from public.order_items i where i.order_id=o.id and position(lower(p->>'product') in lower(i.product_name)) > 0))
   and (nullif(p->>'minQuantity','') is null or (select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id=o.id) >= (p->>'minQuantity')::int)
   and (nullif(p->>'maxQuantity','') is null or (select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id=o.id) <= (p->>'maxQuantity')::int);
$$;

create or replace function public.nemesis_order_flags(o public.orders, p jsonb) returns jsonb
language sql stable set search_path = public, pg_temp as $$
 select coalesce(jsonb_agg(x.flag) filter(where x.flag is not null),'[]'::jsonb) from (values
 (case when o.payment_status='paid' and o.status not in ('cancelled','completed') and o.fulfillment_status not in ('shipped','delivered') then jsonb_build_object('severity','high','reason','Paid but not shipped','next','Verify fulfillment and prepare shipment.') end),
 (case when o.status='processing' and o.updated_at < now()-make_interval(hours=>least(720,greatest(1,coalesce((p->>'processingHours')::int,72)))) then jsonb_build_object('severity','high','reason','Processing without a recent update','next','Investigate stock, payment, and dispatch.') end),
 (case when o.status not in ('cancelled','completed') and o.fulfillment_status not in ('shipped','delivered') and coalesce(o.fulfillment_due_at,o.created_at+make_interval(hours=>least(720,greatest(1,coalesce((p->>'fulfillmentHours')::int,48))))) < now() then jsonb_build_object('severity','high','reason','Expected fulfillment time exceeded','next','Confirm dispatch timing with the fulfillment team.') end),
 (case when o.shipping_status='delayed' or (o.fulfillment_status='shipped' and o.expected_delivery_at < now()) then jsonb_build_object('severity','high','reason','Shipment delayed or delivery estimate exceeded','next','Check carrier tracking and notify the customer.') end),
 (case when o.payment_status='unpaid' and o.status <> 'cancelled' and o.created_at < now()-make_interval(hours=>least(720,greatest(1,coalesce((p->>'paymentHours')::int,24)))) then jsonb_build_object('severity','medium','reason','Unpaid beyond the review threshold (may be COD)','next','Verify the payment method; do not infer a failed payment.') end),
 (case when o.status <> 'cancelled' and (o.fulfillment_status='unknown' or (o.fulfillment_status='shipped' and nullif(o.tracking_number,'') is null)) then jsonb_build_object('severity','medium','reason','Fulfillment or tracking information is incomplete','next','Verify fulfillment details before updating.') end),
 (case when (o.user_id is not null or nullif(o.customer_email,'') is not null) and (select count(*) from (select 1 from orders past where past.status='cancelled' and (case when o.user_id is not null then past.user_id=o.user_id else past.user_id is null and lower(past.customer_email)=lower(o.customer_email) end) limit 3) repeated)>=3 then jsonb_build_object('severity','medium','reason','Customer has at least three historical cancellations','next','Review customer history before further fulfillment; do not assume fraud.') end),
 (case when o.total_micros > coalesce((p->>'highValueMicros')::bigint,1000000000) then jsonb_build_object('severity','medium','reason','Order value exceeds the configured review threshold','next','Review payment legitimacy before dispatch.') end),
 (case when (select coalesce(sum(quantity),0) from order_items where order_id=o.id) > coalesce((p->>'highQuantity')::int,20) then jsonb_build_object('severity','medium','reason','Quantity exceeds the configured review threshold','next','Verify bulk purchasing intent and stock availability.') end),
 (case when o.refund_request_status='requested' and o.refund_requested_at < now()-interval '48 hours' then jsonb_build_object('severity','high','reason','Refund request awaiting resolution for over 48 hours','next','Review in the payment provider; this assistant cannot transfer funds.') end)
 ) x(flag);
$$;

-- Build the full admin widget only for the bounded page, never for every matched row.
create or replace function public.nemesis_order_json(o public.orders, detail boolean, p jsonb, p_flags jsonb default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
 select (case when detail then to_jsonb(o) else jsonb_build_object(
  'id',o.id,'order_number',o.order_number,'status',o.status,'payment_status',o.payment_status,'payment_method',o.payment_method,
  'fulfillment_status',o.fulfillment_status,'shipping_status',o.shipping_status,'shipping_name',o.shipping_name,
  'total_micros',o.total_micros,'created_at',o.created_at,'updated_at',o.updated_at) end)
 || jsonb_build_object('flags',coalesce(p_flags,nemesis_order_flags(o,p)),'quantity',(select coalesce(sum(i.quantity),0) from order_items i where i.order_id=o.id))
 || case when detail then jsonb_build_object(
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from order_items i where i.order_id=o.id),'[]'::jsonb),
  'timeline',coalesce((select jsonb_agg(to_jsonb(e)-'actor_id' order by e.created_at desc,e.id desc) from (select * from order_operations_log where order_id=o.id order by created_at desc,id desc limit 200) e),'[]'::jsonb),
  'timelineCount',(select count(*) from order_operations_log where order_id=o.id)) else '{}'::jsonb end;
$$;

create or replace function public.nemesis_orders_read(p jsonb default '{}', p_mode text default 'search') returns jsonb
language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '8s' as $$
declare result jsonb; total_count bigint; lim int := least(50,greatest(1,coalesce((p->>'limit')::int,20))); begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 if p_mode not in ('search','detail','report','customers','problems') then raise exception 'Invalid report mode'; end if;
 if p_mode in ('report','customers','problems') and not pg_try_advisory_xact_lock(hashtext('nemesis-order-aggregate')) then raise exception 'Another order aggregate report is running; retry shortly or use filtered order search'; end if;
 if p_mode='detail' and nullif(p->>'id','') is null and nullif(p->>'orderNumber','') is null then raise exception 'Exact order required'; end if;
 -- Inline the private SQL scope for indexed keyset search/detail reads. Do not materialize
 -- every full order just to retrieve one page; only aggregates use the shared snapshot.
 if p_mode in ('search','detail') then
  select count(*) into total_count from nemesis_order_scope(p);
  with page as materialized (
   select o.* from nemesis_order_scope(p) o
   where nullif(p->>'cursorAt','') is null or (o.created_at,o.id)<((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid)
   order by created_at desc,id desc limit lim+1
  ), shown as (select * from page order by created_at desc,id desc limit lim)
  select jsonb_build_object('generatedAt',now(),'mode',p_mode,'filters',p,'baseCurrency','USD','total',total_count,
   'hasMore',(select count(*)>lim from page),
   'rows',coalesce((select jsonb_agg(nemesis_order_json(row(s.*)::public.orders,p_mode='detail',p) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
   'metrics',null,'topProducts','[]'::jsonb,'highestRevenueProducts','[]'::jsonb,'customers','[]'::jsonb,'combinations','[]'::jsonb,'daily','[]'::jsonb) into result;
  return result;
 end if;

 with scope as materialized (select * from nemesis_order_scope(p)),
 candidates as (
   select o.* from scope o where p_mode='problems' or
     (nullif(p->>'cursorAt','') is null or (o.created_at,o.id) < ((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid))
   order by created_at desc,id desc limit case when p_mode='problems' then null else lim+1 end
 ),
 flagged as materialized (select o.id,o.created_at,row(o.*)::public.orders as order_row,nemesis_order_flags(row(o.*)::public.orders,p) as flags from candidates o),
 page as (select * from flagged where (p_mode <> 'problems' or jsonb_array_length(flags)>0)
   and (p_mode <> 'problems' or nullif(p->>'cursorAt','') is null or (case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end) > coalesce((p->>'cursorSeverity')::int,0) or ((case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end) = coalesce((p->>'cursorSeverity')::int,0) and (created_at,id)>((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid)))
   order by case when p_mode='problems' then case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end else 0 end, case when p_mode='problems' then created_at end asc,created_at desc,case when p_mode='problems' then id end asc,id desc limit lim+1),
 shown as (select * from page order by case when p_mode='problems' and flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end,case when p_mode='problems' then created_at end asc,created_at desc,case when p_mode='problems' then id end asc,id desc limit lim),
 eligible as materialized(select * from scope where payment_status='paid' and status <> 'cancelled'),
 customer as (
  select md5(coalesce(user_id::text,lower(nullif(customer_email,'')),'order:'||id::text)) as key, min(id::text) as sample_order_id,
   min(shipping_name) as name, count(*) as orders,
   count(*) filter(where payment_status='paid' and status <> 'cancelled') as purchases,
   coalesce(sum(total_micros) filter(where payment_status='paid' and status <> 'cancelled'),0) as spending,
   count(*) filter(where status='cancelled') as cancellations, count(*) filter(where payment_status='refunded') as refunds,
   max(created_at) as last_order, min(created_at) as first_order,
   max(created_at) filter(where payment_status='paid' and status <> 'cancelled') as last_purchase,
   min(created_at) filter(where payment_status='paid' and status <> 'cancelled') as first_purchase
  from scope group by 1
 ),
 customer_cohort as (select * from customer
    where (not coalesce((p->>'inactiveOnly')::boolean,false) or last_purchase < now()-make_interval(days=>least(3650,greatest(1,coalesce((p->>'inactiveDays')::int,90)))))
      and (not coalesce((p->>'repeatOnly')::boolean,false) or purchases>1)
      and (not coalesce((p->>'highRiskOnly')::boolean,false) or cancellations>=3 or refunds>=2)
 ),
 previous as (select * from nemesis_order_scope((p-'cursorAt'-'cursorId') || jsonb_build_object('from',((p->>'from')::timestamptz-((p->>'to')::timestamptz-(p->>'from')::timestamptz)),'to',p->>'from')) where p_mode='report'),
 products as (select coalesce(i.product_id::text,i.product_name) as key,min(i.product_name) as name,sum(i.quantity) as units,sum(i.line_total_micros) as sales from eligible o join order_items i on i.order_id=o.id group by 1),
 daily as (select (created_at at time zone 'UTC')::date as day,count(*) as orders,coalesce(sum(total_micros) filter(where payment_status='paid' and status<>'cancelled'),0) as revenue from scope group by 1),
 basket as (select distinct o.id as order_id,coalesce(i.product_id::text,'name:'||i.product_name) as key,i.product_name as name from eligible o join order_items i on i.order_id=o.id where coalesce((p->>'includeCombinations')::boolean,false)),
 combos as (select min(a.name) as first,min(b.name) as second,count(distinct a.order_id) as orders from basket a join basket b on b.order_id=a.order_id and a.key<b.key group by a.key,b.key order by 3 desc,1,2 limit 10)
 select jsonb_build_object(
  'generatedAt',now(),'mode',p_mode,'filters',p,'baseCurrency','USD',
  'rows',coalesce((select jsonb_agg(nemesis_order_json(s.order_row,false,p,s.flags)
    order by case when p_mode='problems' and s.flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end,case when p_mode='problems' then s.created_at end asc,s.created_at desc,case when p_mode='problems' then s.id end asc,s.id desc) from shown s),'[]'::jsonb),
  'hasMore',(select count(*)>lim from page),
  'total',(select count(*) from scope),
  'metrics',case when p_mode in ('report','customers') then jsonb_build_object(
    'orders',(select count(*) from scope),'paidOrders',(select count(*) from eligible),
    'revenueMicros',(select coalesce(sum(total_micros),0) from eligible),
    'aovMicros',(select coalesce(round(avg(total_micros)),0) from eligible),
    'cancelled',(select count(*) from scope where status='cancelled'),
    'refunded',(select count(*) from scope where payment_status='refunded'),
    'unpaid',(select count(*) from scope where payment_status='unpaid'),
    'statusCounts',(select jsonb_object_agg(status,n) from (select status,count(*) n from scope group by status) z),
    'paymentCounts',(select jsonb_object_agg(payment_status,n) from (select payment_status,count(*) n from scope group by payment_status) z),
    'fulfillmentCounts',(select jsonb_object_agg(fulfillment_status,n) from (select fulfillment_status,count(*) n from scope group by fulfillment_status) z),
    'repeatCustomers',(select count(*) from customer where purchases>1),
    'oneTimeCustomers',(select count(*) from customer where purchases=1),
    'inactiveCustomers',(select count(*) from customer where last_purchase < now()-make_interval(days=>least(3650,greatest(1,coalesce((p->>'inactiveDays')::int,90))))),
    'cohortCustomers',(select count(*) from customer_cohort),
    'cohortSpendingMicros',(select coalesce(sum(spending),0) from customer_cohort),
    'cohortOrders',(select coalesce(sum(orders),0) from customer_cohort),
    'cohortPurchases',(select coalesce(sum(purchases),0) from customer_cohort),
    'previousOrders',(select count(*) from previous),
    'previousRevenueMicros',(select coalesce(sum(total_micros) filter(where payment_status='paid' and status<>'cancelled'),0) from previous)
  ) else null end,
  'topProducts',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(t) order by t.units desc,t.key) from (select * from products order by units desc,key limit 10) t),'[]') else '[]'::jsonb end,
  'highestRevenueProducts',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(t) order by t.sales desc,t.key) from (select * from products order by sales desc,key limit 10) t),'[]') else '[]'::jsonb end,
  'customers',case when p_mode in ('report','customers') then coalesce((select jsonb_agg(to_jsonb(t) order by t.spending desc,t.key) from (select *,case when purchases>1 then extract(epoch from last_purchase-first_purchase)/86400/(purchases-1) else null end as frequency_days from customer_cohort
    order by spending desc,key limit 20) t),'[]') else '[]'::jsonb end,
  'combinations',case when p_mode='customers' then coalesce((select jsonb_agg(to_jsonb(c) order by c.orders desc,c.first,c.second) from combos c),'[]') else '[]'::jsonb end,
  'daily',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from (select * from daily order by day desc limit 60) d),'[]') else '[]'::jsonb end
 ) into result;
 return result;
end $$;

-- Validate operation semantics both when preparing and applying. No arbitrary column patches.
create or replace function public.nemesis_validate_order_action(o public.orders, a text, v jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
 if exists(select 1 from jsonb_object_keys(v) as fields(key) where key <> all(case a
  when 'status' then array['status'] when 'refund_request' then array['text'] when 'note' then array['text'] when 'notification' then array['text']
  when 'fulfillment' then array['fulfillmentStatus','trackingNumber','trackingUrl','carrier','expectedDeliveryAt','fulfillmentDueAt']
  when 'shipping' then array['shippingStatus','trackingNumber','trackingUrl','carrier','expectedDeliveryAt','fulfillmentDueAt'] else array[]::text[] end)) then raise exception 'Payload contains fields unrelated to this operation'; end if;
 if a='status' then
  if coalesce(v->>'status','') not in ('pending','processing','completed','cancelled') then raise exception 'Invalid status'; end if;
  if o.status='cancelled' then raise exception 'Cancelled orders cannot be reopened here'; end if;
  if o.status='completed' and v->>'status'<>'completed' then raise exception 'Completed orders require a manual review; use a refund request if appropriate'; end if;
  if o.payment_status='refunded' then raise exception 'Refunded orders cannot change status here'; end if;
  if v->>'status'='cancelled' and o.payment_status='paid' then raise exception 'Paid orders require a refund review instead of cancellation'; end if;
  if v->>'status'='cancelled' and o.fulfillment_status in ('shipped','delivered') then raise exception 'Shipped orders cannot be cancelled here'; end if;
  if v->>'status'='completed' and (o.payment_status<>'paid' or o.fulfillment_status<>'delivered') then raise exception 'Completion requires paid and delivered'; end if;
  if o.status::text=v->>'status' then raise exception 'Status is unchanged'; end if;
 elsif a='refund_request' then
  if o.payment_status<>'paid' or o.refund_request_status<>'none' then raise exception 'Requires paid order without an existing refund request'; end if;
  if length(trim(coalesce(v->>'text','')))<3 then raise exception 'Refund reason required'; end if;
 elsif a in ('note','notification') then
  if length(trim(coalesce(v->>'text',''))) not between 1 and (case when a='notification' then 200 else 2000 end) then raise exception 'Invalid message length'; end if;
  if a='notification' and o.user_id is null then raise exception 'Guest notifications require a manual email integration'; end if;
 elsif a='fulfillment' then
  if coalesce(v->>'fulfillmentStatus','') not in ('unfulfilled','packed','shipped','delivered') then raise exception 'Invalid fulfillment status'; end if;
  if o.status='cancelled' or o.payment_status='refunded' then raise exception 'Cannot fulfill cancelled/refunded order'; end if;
  if o.status='completed' and o.fulfillment_status<>'unknown' and v->>'fulfillmentStatus'<>o.fulfillment_status then raise exception 'Completed fulfillment cannot be reversed here'; end if;
  if v->>'fulfillmentStatus' in ('shipped','delivered') and o.payment_status<>'paid' and o.payment_method<>'cod' then raise exception 'Payment required before dispatch (except COD)'; end if;
  if o.fulfillment_status='delivered' and v->>'fulfillmentStatus'<>'delivered' then raise exception 'Delivered fulfillment cannot be reversed here'; end if;
  if o.fulfillment_status='shipped' and v->>'fulfillmentStatus' in ('unfulfilled','packed') then raise exception 'Shipped fulfillment cannot be reversed here'; end if;
  if v->>'fulfillmentStatus'='delivered' and o.fulfillment_status<>'shipped' then raise exception 'Record shipment before delivery'; end if;
  if v->>'fulfillmentStatus'='shipped' and nullif(coalesce(v->>'trackingNumber',o.tracking_number),'') is null then raise exception 'Tracking number required for shipment'; end if;
 elsif a='shipping' then
  if o.status='cancelled' or o.payment_status='refunded' then raise exception 'Cannot change shipping on cancelled/refunded order'; end if;
  if v ? 'shippingStatus' and coalesce(v->>'shippingStatus','') not in ('pending','in_transit','delayed','delivered') then raise exception 'Invalid shipping status'; end if;
  if v->>'shippingStatus' in ('in_transit','delayed','delivered') and o.fulfillment_status not in ('shipped','delivered') then raise exception 'Record fulfillment shipment first'; end if;
  if v->>'shippingStatus'='delivered' and o.fulfillment_status<>'delivered' then raise exception 'Record delivered fulfillment first'; end if;
  if o.fulfillment_status='delivered' and v ? 'shippingStatus' and v->>'shippingStatus'<>'delivered' then raise exception 'Delivered shipping cannot be reversed'; end if;
 else raise exception 'Unsupported order action'; end if;
 if coalesce(length(v->>'trackingNumber'),0)>200 or coalesce(length(v->>'carrier'),0)>120 or coalesce(length(v->>'trackingUrl'),0)>1000 or coalesce(length(v->>'text'),0)>2000 then raise exception 'Operation text too long'; end if;
 if v ? 'trackingUrl' and coalesce(v->>'trackingUrl','') !~ '^https://[^[:space:]]+$' then raise exception 'Tracking URL must use HTTPS'; end if;
 if v ? 'expectedDeliveryAt' and (v->>'expectedDeliveryAt')::timestamptz < o.created_at then raise exception 'Delivery estimate precedes order'; end if;
 if v ? 'fulfillmentDueAt' and (v->>'fulfillmentDueAt')::timestamptz < o.created_at then raise exception 'Fulfillment deadline precedes order'; end if;
end $$;

create or replace function public.nemesis_prepare_order_action(p_order_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; preview order_action_previews; begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 select * into o from orders where id=p_order_id;
 if not found then raise exception 'Order not found'; end if;
 perform nemesis_validate_order_action(o,p_action,p_payload);
 delete from order_action_previews where actor_id=auth.uid() and expires_at < now()-interval '30 days';
 insert into order_action_previews(actor_id,order_id,order_version,action,payload) values(auth.uid(),o.id,o.updated_at,p_action,p_payload) returning * into preview;
 return jsonb_build_object('previewId',preview.id,'orderId',o.id,'orderNumber',o.order_number,'version',o.updated_at,'oldStatus',o.status,'oldFulfillment',o.fulfillment_status,'oldShipping',o.shipping_status,'expiresAt',preview.expires_at);
end $$;

create or replace function public.nemesis_apply_order_action(p_preview_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '8s' as $$
declare pr order_action_previews; o orders; v jsonb; failure text; begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 select * into pr from order_action_previews where id=p_preview_id and actor_id=auth.uid() for update;
 if not found then raise exception 'Approval preview not found for this administrator'; end if;
 if pr.used_at is not null then raise exception 'This approval has already been used'; end if;
 update order_action_previews set used_at=now() where id=pr.id;
 begin
  if pr.expires_at < now() then raise exception 'Preview expired; generate a new preview'; end if;
  select * into o from orders where id=pr.order_id for update;
  if not found then raise exception 'Order no longer exists'; end if;
  if o.updated_at is distinct from pr.order_version then raise exception 'Order changed after preview; regenerate before approval'; end if;
  v := pr.payload;
  perform nemesis_validate_order_action(o,pr.action,v);
  if pr.action='status' then
   -- Existing stock snapshot trigger handles cancellation/restocking atomically.
   update orders set status=(v->>'status')::order_status where id=o.id;
  elsif pr.action='refund_request' then
   update orders set refund_request_status='requested',refund_requested_at=now() where id=o.id;
  elsif pr.action='fulfillment' then
   update orders set fulfillment_status=v->>'fulfillmentStatus',
    shipping_status=case v->>'fulfillmentStatus' when 'shipped' then 'in_transit' when 'delivered' then 'delivered' else 'pending' end,
    fulfilled_at=case when v->>'fulfillmentStatus' in ('shipped','delivered') then coalesce(fulfilled_at,now()) else fulfilled_at end,
    shipped_at=case when v->>'fulfillmentStatus'='shipped' then coalesce(shipped_at,now()) else shipped_at end,
    delivered_at=case when v->>'fulfillmentStatus'='delivered' then coalesce(delivered_at,now()) else delivered_at end where id=o.id;
  elsif pr.action='notification' then
   insert into order_messages(order_id,sender_type,sender_id,sender_name,message) values(o.id,'admin',auth.uid(),'Store administrator',v->>'text');
  end if;
  if pr.action in ('shipping','fulfillment') then
   update orders set tracking_number=coalesce(v->>'trackingNumber',tracking_number),tracking_url=coalesce(v->>'trackingUrl',tracking_url),shipping_carrier=coalesce(v->>'carrier',shipping_carrier),
    expected_delivery_at=coalesce((v->>'expectedDeliveryAt')::timestamptz,expected_delivery_at),fulfillment_due_at=coalesce((v->>'fulfillmentDueAt')::timestamptz,fulfillment_due_at),
    shipping_status=case when pr.action='shipping' then coalesce(v->>'shippingStatus',shipping_status) else shipping_status end where id=o.id;
  end if;
  -- Notes/notifications also advance the version; two stale approvals cannot overwrite context.
  update orders set updated_at=clock_timestamp() where id=o.id;
  insert into order_operations_log(order_id,order_number,actor_id,event,message) values(o.id,o.order_number,auth.uid(),pr.action,case when pr.action in ('note','notification','refund_request') then coalesce(v->>'text',pr.action) else v::text end);
 exception when others then
  get stacked diagnostics failure=message_text;
 end;
 if failure is not null then
  insert into order_operations_log(order_id,order_number,actor_id,event,message,success) values(pr.order_id,(select order_number from orders where id=pr.order_id),auth.uid(),pr.action,failure,false);
  return jsonb_build_object('ok',false,'error',failure);
 end if;
 return jsonb_build_object('ok',true,'orderId',pr.order_id,'action',pr.action);
end $$;

revoke all on function public.nemesis_order_json(public.orders,boolean,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.stamp_order_intelligence_payment() from public, anon, authenticated;
revoke all on function public.capture_order_intelligence_event() from public, anon, authenticated;
revoke all on function public.nemesis_order_scope(jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_order_flags(public.orders,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_validate_order_action(public.orders,text,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_orders_read(jsonb,text) from public, anon, authenticated;
revoke all on function public.nemesis_prepare_order_action(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_apply_order_action(uuid) from public, anon, authenticated;
grant execute on function public.nemesis_orders_read(jsonb,text) to authenticated;
grant execute on function public.nemesis_prepare_order_action(uuid,text,jsonb) to authenticated;
grant execute on function public.nemesis_apply_order_action(uuid) to authenticated;

-- =============================================================================
-- 20261052000000_ai_diagnostic_logs.sql
-- (migration 20261052000000_ai_diagnostic_logs.sql)
-- =============================================================================

-- Private, disposable AI diagnostics. Operational audits are deliberately separate.
create extension if not exists pg_cron;

create table public.diagnostic_log_settings (
 id boolean primary key default true check (id),
 retention_hours integer not null default 72 check (retention_hours in (1,3,6,24,72)),
 last_cleanup_at timestamptz,
 last_cleanup_deleted integer not null default 0
);
insert into public.diagnostic_log_settings(id) values(true);
alter table public.diagnostic_log_settings enable row level security;
revoke all on public.diagnostic_log_settings from public, anon, authenticated;
grant select on public.diagnostic_log_settings to authenticated;
grant update(retention_hours) on public.diagnostic_log_settings to authenticated;
create policy "Admins read diagnostic settings" on public.diagnostic_log_settings for select to authenticated using(public.is_admin());
create policy "Admins change retention" on public.diagnostic_log_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());

create table public.ai_diagnostic_logs (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid default auth.uid() references auth.users(id) on delete set null,
 trace_id uuid not null,
 category text not null default 'ai' check(category = 'ai'),
 source text not null check(source in ('server','worker','browser')),
 provider text not null check(length(provider) <= 60),
 model text not null check(length(model) <= 200),
 status text not null default 'pending' check(status in ('pending','success','error')),
 http_status integer,
 duration_ms integer,
 input_tokens bigint,
 output_tokens bigint,
 request_payload jsonb not null check(octet_length(request_payload::text) <= 300000),
 response_payload jsonb check(octet_length(response_payload::text) <= 300000)
);
create index ai_diagnostic_logs_created_idx on public.ai_diagnostic_logs(created_at desc,id desc);
create index ai_diagnostic_logs_trace_idx on public.ai_diagnostic_logs(trace_id,created_at);
alter table public.ai_diagnostic_logs enable row level security;
revoke all on public.ai_diagnostic_logs from public, anon, authenticated;
grant select,delete on public.ai_diagnostic_logs to authenticated;
grant insert(trace_id,source,provider,model,request_payload) on public.ai_diagnostic_logs to authenticated;
grant update(status,http_status,duration_ms,input_tokens,output_tokens,response_payload) on public.ai_diagnostic_logs to authenticated;
create policy "Admins read AI diagnostics" on public.ai_diagnostic_logs for select to authenticated using(public.is_admin());
create policy "Admins delete AI diagnostics" on public.ai_diagnostic_logs for delete to authenticated using(public.is_admin());
create policy "Admins insert own AI diagnostics" on public.ai_diagnostic_logs for insert to authenticated with check(public.is_admin() and actor_id=auth.uid());
create policy "Admins finish own AI diagnostics" on public.ai_diagnostic_logs for update to authenticated using(public.is_admin() and actor_id=auth.uid()) with check(public.is_admin() and actor_id=auth.uid());

-- No authenticated execution: only the postgres-owned pg_cron job runs this function.
create function public.cleanup_ai_diagnostic_logs() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutoff timestamptz; n integer; removed integer := 0;
begin
 if not pg_try_advisory_xact_lock(782164291) then return; end if;
 select clock_timestamp() - make_interval(hours => retention_hours) into cutoff from public.diagnostic_log_settings where id;
 if cutoff is null then raise exception 'Missing log retention settings'; end if;
 for batch in 1..10 loop
   with expired as (
     select id from public.ai_diagnostic_logs where created_at < cutoff
     order by created_at,id limit 500 for update skip locked
   ) delete from public.ai_diagnostic_logs l using expired e where l.id=e.id;
   get diagnostics n = row_count;
   removed := removed+n;
   exit when n < 500;
 end loop;
 update public.diagnostic_log_settings set last_cleanup_at=clock_timestamp(),last_cleanup_deleted=removed where id;
end;
$$;
revoke all on function public.cleanup_ai_diagnostic_logs() from public,anon,authenticated;
select cron.schedule('nemesis-ai-log-retention','*/5 * * * *','select public.cleanup_ai_diagnostic_logs()');

-- =============================================================================
-- 20261053000000_client_setup_export.sql
-- (migration 20261053000000_client_setup_export.sql)
-- =============================================================================

-- Live client bootstrap export, not a backup. Never read business/auth rows.
-- A registry makes NEW configuration fields opt-in rather than accidentally leaking secrets.
create table public.client_setup_fields (
 table_name text not null check (table_name ~ '^[a-z_][a-z0-9_]*$'),
 column_name text not null check (column_name ~ '^[a-z_][a-z0-9_]*$'),
 primary key(table_name,column_name),
 check (table_name in ('site_settings','ai_settings','diagnostic_log_settings'))
);
alter table public.client_setup_fields enable row level security;
revoke all on public.client_setup_fields from public,anon,authenticated;
-- Only database migrations maintain this safety boundary. Dashboard admins cannot widen it.
insert into public.client_setup_fields(table_name,column_name)
select 'site_settings',unnest(array[
 'currency','usd_to_bdt_rate','manage_stock','payment_cod_enabled','shipping_enabled','shipping_rate_micros',
 'theme_light','theme_dark','theme_gradients','theme_sync',
 'home_show_categories','home_show_featured','home_show_filter','home_show_hero',
 'home_show_category_sections','home_category_default_layout','home_category_banner_style'
]) union all select 'ai_settings',unnest(array[
 'provider','primary_model','fallback_model','ollama_mode','ollama_num_ctx','ollama_disable_thinking',
 'token_budget_mode','reasoning_effort','temperature','vision_enabled','brand_tone','default_language'
]) union all select 'diagnostic_log_settings','retention_hours';

create function public.export_client_setup(p_copy_settings boolean default true) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
set statement_timeout='25s'
as $export$
declare
 out_sql text; r record; a record; g record; stmt text; role_name text;
 config jsonb; filtered jsonb; omitted jsonb := '{}'::jsonb;
 identity_sql text; copied integer := 0; registry_sql text := '';
 view_count integer; emitted_views oid[] := '{}'; candidates integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 -- Fail visibly for unsupported constructs, never return an apparently complete partial dump.
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and (c.relkind in ('p','f','m') or c.relispartition or c.reloftype<>0))
 or exists(select 1 from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
 or exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attgenerated<>'')
 or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('d','r','m') and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e'))
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='c')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind not in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))

 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype join pg_class c on c.oid=t.typrelid where n.nspname='public' and c.relkind='v')
 or exists(select 1 from pg_rewrite rw join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and rw.rulename<>'_RETURN')
 then raise exception 'Schema contains advanced objects this application exporter does not support. Use a reviewed pg_dump --schema-only export instead.'; end if;

 out_sql := '-- Woo Solution: LIVE fresh-client setup (not a backup)' || E'\n-- Generated ' || clock_timestamp()::text || E'\n-- Run once, as postgres, in a NEW Supabase project. Requires PostgreSQL 17+.\n-- No users, business records, files or credentials are copied. Read README-CLIENT-SETUP.md.\nbegin;\nset local check_function_bodies = off;\nset local search_path = public, extensions, pg_catalog;\n';
 out_sql := out_sql || E'do $fresh$ begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=''public'' and c.relkind in (''r'',''p'',''v'',''m'',''S'') and not exists(select 1 from pg_depend d where d.classid=''pg_class''::regclass and d.objid=c.oid and d.deptype=''e'')) then raise exception ''Fresh Supabase project required: public application objects already exist''; end if; end $fresh$;\n';
 -- Supabase owns its auth/storage schemas. Install extension declarations, not their internals.
 for r in select e.extname,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname not in ('plpgsql','pg_stat_statements','supabase_vault') order by e.extname loop
   if r.nspname not in ('pg_catalog','public') then out_sql:=out_sql||format('create schema if not exists %I;',r.nspname)||E'\n'; end if;
   out_sql:=out_sql||format('create extension if not exists %I with schema %I;',r.extname,r.nspname)||E'\n';
 end loop;
 -- Enums precede columns; extension-owned objects are restored by CREATE EXTENSION.
 for r in select t.oid,t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e') order by t.typname loop
   select string_agg(quote_literal(enumlabel),', ' order by enumsortorder) into stmt from pg_enum where enumtypid=r.oid;
   out_sql:=out_sql||format('create type public.%I as enum (%s);',r.typname,stmt)||E'\n';
 end loop;
 -- Empty sequences retain configuration, NEVER their current values.
 for r in select c.oid,c.relname,s.* from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_sequence s on s.seqrelid=c.oid where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('i','e')) order by c.relname loop
   out_sql:=out_sql||format('create sequence public.%I as %s increment by %s minvalue %s maxvalue %s start with %s cache %s %s;',r.relname,format_type(r.seqtypid,null),r.seqincrement,r.seqmin,r.seqmax,r.seqstart,r.seqcache,case when r.seqcycle then 'cycle' else 'no cycle' end)||E'\n';
 end loop;
 for r in select c.oid,c.relname,c.relpersistence,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname loop
   stmt:='';
   for a in select a.*,format_type(a.atttypid,a.atttypmod) as type_sql from pg_attribute a where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped order by a.attnum loop
     identity_sql:='';
     if a.attidentity<>'' then
       select format(' generated %s as identity (sequence name public.%I increment by %s minvalue %s maxvalue %s start with %s cache %s %s)',case when a.attidentity='a' then 'always' else 'by default' end,seq.relname,q.seqincrement,q.seqmin,q.seqmax,q.seqstart,q.seqcache,case when q.seqcycle then 'cycle' else 'no cycle' end)
       into identity_sql from pg_depend d join pg_class seq on seq.oid=d.objid join pg_sequence q on q.seqrelid=seq.oid where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass and d.deptype='i' and d.refobjid=r.oid and d.refobjsubid=a.attnum;
       if identity_sql is null then raise exception 'Missing identity configuration'; end if;
     end if;
     stmt:=stmt||case when stmt='' then '' else E',\n' end||format('  %I %s%s%s%s',a.attname,a.type_sql,case when a.attcollation<>0 and a.attcollation<>(select typcollation from pg_type where oid=a.atttypid) then ' collate '||a.attcollation::regcollation::text else '' end,identity_sql,case when a.attnotnull then ' not null' else '' end);
   end loop;
   out_sql:=out_sql||format(E'create %stable public.%I (\n%s\n);',case when r.relpersistence='u' then 'unlogged ' else '' end,r.relname,stmt)||E'\n';
   if r.reloptions is not null then out_sql:=out_sql||format('alter table public.%I set (%s);',r.relname,array_to_string(r.reloptions,', '))||E'\n'; end if;
 end loop;
 -- Function bodies are checked after restore; their referenced tables now exist.
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by p.proname,p.oid loop
   out_sql:=out_sql||pg_get_functiondef(r.oid)||E';\n';
 end loop;
 -- Defaults and constraints after functions. PK/unique/exclusion must precede foreign keys.
 for r in select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=d.adnum where n.nspname='public' order by c.relname,a.attnum loop
   out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';
 end loop;
 for r in select c.relname,con.conname,pg_get_constraintdef(con.oid,true) as def from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype<>'f' order by c.relname,con.conname loop
   out_sql:=out_sql||format('alter table public.%I add constraint %I %s;',r.relname,r.conname,r.def)||E'\n';
 end loop;
 for r in select pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not exists(select 1 from pg_constraint con where con.conindid=i.indexrelid) order by c.relname,i.indexrelid loop
   out_sql:=out_sql||r.def||E';\n';
 end loop;
 for r in select c.relname,con.conname,pg_get_constraintdef(con.oid,true) as def from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype='f' order by c.relname,con.conname loop
   out_sql:=out_sql||format('alter table public.%I add constraint %I %s;',r.relname,r.conname,r.def)||E'\n';
 end loop;
 for r in select seq.relname as seqname,c.relname,a.attname from pg_depend d join pg_class seq on seq.oid=d.objid and seq.relkind='S' join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=seq.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=d.refobjsubid where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass and d.deptype='a' and n.nspname='public' loop
   out_sql:=out_sql||format('alter sequence public.%I owned by public.%I.%I;',r.seqname,r.relname,r.attname)||E'\n';
 end loop;
 -- Views topologically ordered; stop rather than silently break a dependency cycle.
 select count(*) into view_count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e');
 while cardinality(emitted_views)<view_count loop
   candidates:=0;
   for r in select c.oid,c.relname,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not c.oid=any(emitted_views) and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') and not exists(select 1 from pg_rewrite rw join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=rw.oid join pg_class dep on dep.oid=d.refobjid join pg_namespace dn on dn.oid=dep.relnamespace where rw.ev_class=c.oid and d.refclassid='pg_class'::regclass and dep.relkind='v' and dn.nspname='public' and dep.oid<>c.oid and not dep.oid=any(emitted_views)) order by c.relname loop
     out_sql:=out_sql||format('create view public.%I%s as %s',r.relname,case when r.reloptions is null then '' else ' with ('||array_to_string(r.reloptions,', ')||')' end,pg_get_viewdef(r.oid,true))||E';\n';
     emitted_views:=array_append(emitted_views,r.oid); candidates:=candidates+1;
   end loop;
   if candidates=0 then raise exception 'Unresolved view dependencies: use pg_dump'; end if;
 end loop;
 -- Application triggers on auth/storage are included, not managed platform triggers.
 for r in select t.oid,t.tgname,t.tgenabled,c.relname,n.nspname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and (n.nspname='public' or (n.nspname in ('auth','storage') and pn.nspname='public')) and not exists(select 1 from pg_depend d where d.classid='pg_trigger'::regclass and d.objid=t.oid and d.deptype='e') order by n.nspname,c.relname,t.tgname loop
   out_sql:=out_sql||format('drop trigger if exists %I on %I.%I;',r.tgname,r.nspname,r.relname)||E'\n'||pg_get_triggerdef(r.oid,true)||E';\n';
   if r.tgenabled<>'O' then out_sql:=out_sql||format('alter table %I.%I %s trigger %I;',r.nspname,r.relname,case r.tgenabled when 'D' then 'disable' when 'R' then 'enable replica' else 'enable always' end,r.tgname)||E'\n'; end if;
 end loop;
 for r in select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
   out_sql:=out_sql||format('alter table public.%I %s row level security;',r.relname,case when r.relrowsecurity then 'enable' else 'disable' end)||E'\n';
   if r.relforcerowsecurity then out_sql:=out_sql||format('alter table public.%I force row level security;',r.relname)||E'\n'; end if;
   if r.relreplident='f' then out_sql:=out_sql||format('alter table public.%I replica identity full;',r.relname)||E'\n';
   elsif r.relreplident='n' then out_sql:=out_sql||format('alter table public.%I replica identity nothing;',r.relname)||E'\n';
   elsif r.relreplident='i' then select ic.relname into stmt from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=(format('public.%I',r.relname))::regclass and i.indisreplident; out_sql:=out_sql||format('alter table public.%I replica identity using index %I;',r.relname,stmt)||E'\n'; end if;
 end loop;
 for r in select p.*,c.relname,n.nspname from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' or (n.nspname='storage' and c.relname in ('objects','buckets')) order by n.nspname,c.relname,p.polname loop
   select string_agg(case when x=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x)) end,', ') into stmt from unnest(r.polroles) x;
   out_sql:=out_sql||format('drop policy if exists %I on %I.%I;',r.polname,r.nspname,r.relname)||E'\n'||format('create policy %I on %I.%I as %s for %s to %s%s%s;',r.polname,r.nspname,r.relname,case when r.polpermissive then 'permissive' else 'restrictive' end,case r.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,stmt,case when r.polqual is null then '' else ' using ('||pg_get_expr(r.polqual,r.polrelid)||')' end,case when r.polwithcheck is null then '' else ' with check ('||pg_get_expr(r.polwithcheck,r.polrelid)||')' end)||E'\n';
 end loop;
 -- Restore public-schema and enum permissions without relying on target defaults.
 out_sql:=out_sql||E'revoke all on schema public from PUBLIC, anon, authenticated, service_role;\n';
 for g in select x.* from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where n.nspname='public' loop
   role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
   out_sql:=out_sql||format('grant %s on schema public to %s%s;',g.privilege_type,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
 end loop;
 for r in select t.* from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e') loop
   out_sql:=out_sql||format('revoke all on type public.%I from PUBLIC, anon, authenticated, service_role;',r.typname)||E'\n';
   for g in select * from aclexplode(coalesce(r.typacl,acldefault('T',r.typowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant %s on type public.%I to %s%s;',g.privilege_type,r.typname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 -- Explicit ACL reconstruction prevents broad fresh-project default grants leaking private tables.
 for r in select c.oid,c.relname,c.relkind,c.relowner,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname loop
   stmt:=case when r.relkind='S' then 'sequence' else 'table' end;
   out_sql:=out_sql||format('revoke all on %s public.%I from PUBLIC, anon, authenticated, service_role;',stmt,r.relname)||E'\n';
   for g in select * from aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 'S'::"char" else 'r'::"char" end,r.relowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant %s on %s public.%I to %s%s;',g.privilege_type,stmt,r.relname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
   for a in select attname,attacl from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped and attacl is not null loop
     for g in select * from aclexplode(a.attacl) loop
       role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
       out_sql:=out_sql||format('grant %s (%I) on table public.%I to %s%s;',g.privilege_type,a.attname,r.relname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
     end loop;
   end loop;
 end loop;
 for r in select p.*,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
   stmt:=case when r.prokind='p' then 'procedure' else 'function' end;
   out_sql:=out_sql||format('revoke all on %s public.%I(%s) from PUBLIC, anon, authenticated, service_role;',stmt,r.proname,r.args)||E'\n';
   for g in select * from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant execute on %s public.%I(%s) to %s%s;',stmt,r.proname,r.args,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 for r in select d.* from pg_default_acl d where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace loop
   stmt:=case r.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' else null end;
   if stmt is null then raise exception 'Unsupported default privilege type'; end if;
   out_sql:=out_sql||format('alter default privileges for role postgres in schema public revoke all on %s from PUBLIC, anon, authenticated, service_role;',stmt)||E'\n';
   for g in select * from aclexplode(r.defaclacl) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('alter default privileges for role postgres in schema public grant %s on %s to %s%s;',g.privilege_type,stmt,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 -- Preserve bootstrap field registry rows (configuration, never business records).
 for r in select * from public.client_setup_fields order by table_name,column_name loop
   registry_sql:=registry_sql||format('insert into public.client_setup_fields(table_name,column_name) values (%L,%L);',r.table_name,r.column_name)||E'\n';
 end loop;
 out_sql:=out_sql||registry_sql;
 -- Seed singleton defaults, then optionally overlay explicitly safe CURRENT values.
 for r in select unnest(array['site_settings','ai_settings','diagnostic_log_settings']) as name loop
   if to_regclass('public.'||r.name) is null then continue; end if;
   out_sql:=out_sql||format('insert into public.%I(id) values (%s);',r.name,case when r.name='diagnostic_log_settings' then 'true' else '1' end)||E'\n';
   execute format('select to_jsonb(s) from public.%I s limit 1',r.name) into config;
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into filtered from jsonb_each(coalesce(config,'{}')) where p_copy_settings and key in (select column_name from public.client_setup_fields where table_name=r.name);
   select omitted||jsonb_build_object(r.name,coalesce(jsonb_agg(key),'[]'::jsonb)) into omitted from jsonb_each(coalesce(config,'{}')) where key not in (select column_name from public.client_setup_fields where table_name=r.name) and key<>'id';
   select string_agg(format('%I = %L::%s',a.attname,filtered->>a.attname,format_type(a.atttypid,a.atttypmod)),', ' order by a.attnum) into stmt from pg_attribute a where a.attrelid=to_regclass('public.'||r.name) and a.attnum>0 and not a.attisdropped and filtered ? a.attname;
   if stmt is not null then out_sql:=out_sql||format('update public.%I set %s;',r.name,stmt)||E'\n'; select copied+count(*)::integer into copied from jsonb_object_keys(filtered); end if;
 end loop;
 out_sql:=out_sql||E'update public.site_settings set payment_crypto_enabled=false,payment_plisio_enabled=false,seo_indexing=false;\nupdate public.ai_settings set enabled=false,require_confirmation=true;\n';
 -- Realtime memberships, bucket configuration and pg_cron declarations are configuration, not content.
 for r in select b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types from storage.buckets b order by b.id loop
   out_sql:=out_sql||format('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values (%L,%L,%L,%L,%L) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;',r.id,r.name,r.public,r.file_size_limit,r.allowed_mime_types)||E'\n';
 end loop;
 for r in select p.pubname,c.relname from pg_publication_rel pr join pg_publication p on p.oid=pr.prpubid join pg_class c on c.oid=pr.prrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and p.pubname='supabase_realtime' loop
   out_sql:=out_sql||format('alter publication supabase_realtime add table public.%I;',r.relname)||E'\n';
 end loop;
 if exists(select 1 from pg_extension where extname='pg_cron') then
   for r in select jobname,schedule,command,active from cron.job where jobname like 'nemesis-%' order by jobname loop
     if r.command !~* '^\s*select\s+public\.[a-z_][a-z0-9_]*\(\s*\)\s*;?\s*$' then raise exception 'Scheduled job % needs a reviewed configuration export',r.jobname; end if;
     out_sql:=out_sql||format('select cron.schedule(%L,%L,%L);',r.jobname,r.schedule,r.command)||E'\n';
     if not r.active then out_sql:=out_sql||format('select cron.alter_job((select jobid from cron.job where jobname=%L),active:=false);',r.jobname)||E'\n'; end if;
   end loop;
 end if;
 out_sql:=out_sql||E'notify pgrst, ''reload schema'';\ncommit;\n-- Next: configure Auth URLs, create your own admin, deploy the client GitHub repository to Cloudflare Workers.\n';
 return jsonb_build_object('sql',out_sql,'omitted_settings',omitted,'copied_fields',copied,'exported_at',clock_timestamp(),'scope','public schema + app auth/storage integration; no business rows');
end;
$export$;
revoke all on function public.export_client_setup(boolean) from public,anon,authenticated;
grant execute on function public.export_client_setup(boolean) to authenticated;

-- =============================================================================
-- 20261054000000_client_setup_export_resolution.sql
-- (migration 20261054000000_client_setup_export_resolution.sql)
-- =============================================================================

-- Catalog aliases (notably `a`) also appear as PL/pgSQL record names. Resolve
-- qualified catalog columns as columns; outer records still resolve when no
-- matching SQL alias exists. Keep the full export definition in the prior migration.
do $fix$
declare definition text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'#variable_conflict use_column')=0 then
   if strpos(definition,E'\ndeclare\n out_sql')=0 then
     raise exception 'Unexpected export function definition; inspect before updating';
   end if;
   execute replace(definition,E'\ndeclare\n out_sql',E'\n#variable_conflict use_column\ndeclare\n out_sql');
 end if;
end;
$fix$;

-- =============================================================================
-- 20261055000000_client_setup_export_guardrails.sql
-- (migration 20261055000000_client_setup_export_guardrails.sql)
-- =============================================================================

-- Reject dependencies outside this bootstrap's deliberately supported scope.
create function public.assert_client_setup_scope() returns void
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
begin
 if exists (
   select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p','v','m','S','f') and c.relowner='postgres'::regrole
   and n.nspname !~ '^pg_' and n.nspname not in ('public','information_schema','auth','storage','realtime','extensions','vault','graphql','graphql_public','supabase_functions','supabase_migrations','cron','net','pgbouncer')
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S') and c.relowner<>'postgres'::regrole
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proowner<>'postgres'::regrole
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_collation c join pg_namespace n on n.oid=c.collnamespace where n.nspname='public'
   and not exists(select 1 from pg_depend d where d.classid='pg_collation'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_publication p left join pg_publication_rel pr on pr.prpubid=p.oid where p.pubname='supabase_realtime' and (p.puballtables or pr.prqual is not null or pr.prattrs is not null)
 ) or exists (
   select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('site_settings','ai_settings','diagnostic_log_settings') and a.attnum>0 and not a.attisdropped and a.attnotnull and a.attname<>'id' and a.attidentity=''
   and not exists(select 1 from pg_attrdef d where d.adrelid=c.oid and d.adnum=a.attnum)
 ) then raise exception 'Application schemas, ownership, collations, publication filters or required settings defaults need a reviewed bootstrap'; end if;
end;
$$;
revoke all on function public.assert_client_setup_scope() from public,anon,authenticated;

alter function public.export_client_setup(boolean) set search_path=pg_catalog,public,pg_temp;
-- Extend the body without duplicating a large SQL generator. Preserve its ACL.
do $guard$
declare definition text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'perform public.assert_client_setup_scope();')=0 then
   if strpos(definition,' -- Fail visibly for unsupported constructs')=0 then raise exception 'Unexpected export function definition'; end if;
   execute replace(definition,' -- Fail visibly for unsupported constructs',E' perform public.assert_client_setup_scope();\n -- Fail visibly for unsupported constructs');
 end if;
end;
$guard$;
-- Accidental registration of obviously sensitive/reference fields is disallowed.
alter table public.client_setup_fields add constraint client_setup_no_sensitive_fields
 check (column_name !~* '(password|secret|api_keys?|access_token|refresh_token|wallet|address|media_id|^id$|url$)');

-- =============================================================================
-- 20261056000000_client_setup_stored_generated.sql
-- (migration 20261056000000_client_setup_stored_generated.sql)
-- =============================================================================

-- PostgreSQL 17: preserve stored generated-column position and expressions.
-- Typed NULL stubs let tables/row types exist before user functions are restored;
-- SET EXPRESSION then installs the real formula before defaults/constraints/seeds.
-- No existing application columns, expressions or rows are changed here.
do $patch$
declare
 definition text;
 old_part text;
 new_part text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'-- Stored generated placeholders preserve column order.')>0 then return; end if;

 old_part := $old$where n.nspname='public' and a.attgenerated<>''$old$;
 new_part := $new$where n.nspname='public' and a.attgenerated not in ('','s')$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export generated-column guard'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$     identity_sql:='';
     if a.attidentity<>'' then$old$;
 new_part := $new$     identity_sql:='';
     -- Stored generated placeholders preserve column order.
     if a.attgenerated='s' then
       identity_sql:=format(' generated always as (null::%s) stored',a.type_sql);
     end if;
     if a.attidentity<>'' then$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export column builder'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef$old$;
 new_part := $new$select c.relname,a.attname,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export default query'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$   out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';$old$;
 new_part := $new$   if r.attgenerated='s' then
     out_sql:=out_sql||format('alter table public.%I alter column %I set expression as (%s);',r.relname,r.attname,r.expr)||E'\n';
   else
     out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';
   end if;$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export default builder'; end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end;
$patch$;
notify pgrst, 'reload schema';

-- =============================================================================
-- 20261057000000_customer_intelligence.sql
-- (migration 20261057000000_customer_intelligence.sql)
-- =============================================================================

-- Read-only Customer Intelligence. No new customer shadow table or mutation RPC.
create index if not exists orders_customer_history_idx on public.orders(user_id,created_at desc,id desc);
create index if not exists orders_guest_customer_key_idx on public.orders((md5(lower(btrim(customer_email))))) where user_id is null and nullif(btrim(customer_email),'') is not null;

create function public.nemesis_customers_read(p jsonb default '{}', p_mode text default 'analytics') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp
set statement_timeout='15s' as $$
#variable_conflict use_column
declare
 result jsonb;
 as_of timestamptz := coalesce((p->>'to')::timestamptz,statement_timestamp());
 since timestamptz := coalesce((p->>'from')::timestamptz,case when p_mode in ('new','analytics') then as_of-interval '30 days' else '1970-01-01'::timestamptz end);
 days integer := coalesce((p->>'inactiveDays')::integer,90);
 min_purchases integer := coalesce((p->>'minPurchases')::integer,case when p_mode='repeat' then 2 else 0 end);
 page_size integer := coalesce((p->>'limit')::integer,10);
 page_no integer := coalesce((p->>'page')::integer,1);
 exact_key text := p->>'customerKey';
 q text := nullif(btrim(p->>'search'),'');
 sort_by text := coalesce(p->>'sort',case when p_mode='new' then 'newest' when p_mode='inactive' then 'oldest' else 'spending' end);
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_mode not in ('details','history','search','top','inactive','repeat','new','analytics') then raise exception 'Invalid customer report'; end if;
 if page_size not between 1 and 50 or page_no not between 1 and 10000 or days not between 1 and 3650 or min_purchases not between 0 and 100000 then raise exception 'Invalid customer pagination or thresholds'; end if;
 if since>=as_of or as_of>statement_timestamp()+interval '1 minute' then raise exception 'Invalid customer date range'; end if;
 if p_mode='repeat' then min_purchases:=greatest(2,min_purchases); end if;
 if sort_by not in ('spending','purchases','newest','oldest','name') then raise exception 'Invalid customer sort'; end if;
 if length(coalesce(q,''))>120 then raise exception 'Search is too long'; end if;
 if exact_key is not null and exact_key !~ '^((u|o):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{32})$' then raise exception 'Invalid customer key'; end if;
 if p_mode in ('details','history') and exact_key is null then raise exception 'Select an exact customer, not a name'; end if;

 with orders_as_of as materialized (
   select o.id,o.user_id,o.customer_email,o.shipping_name,o.created_at,o.order_number,o.status,o.payment_status,o.total_micros,
     case when o.user_id is not null then 'u:'||o.user_id::text
       when nullif(btrim(o.customer_email),'') is not null then 'e:'||md5(lower(btrim(o.customer_email))) else 'o:'||o.id::text end as customer_key,
     (o.status='completed' and o.payment_status='paid') as eligible
   from public.orders o where o.created_at<as_of and (
     exact_key is null
     or (left(exact_key,2)='u:' and o.user_id=case when left(exact_key,2)='u:' then substring(exact_key from 3)::uuid end)
     or (left(exact_key,2)='e:' and o.user_id is null and nullif(btrim(o.customer_email),'') is not null and md5(lower(btrim(o.customer_email)))=substring(exact_key from 3))
     or (left(exact_key,2)='o:' and o.id=case when left(exact_key,2)='o:' then substring(exact_key from 3)::uuid end and o.user_id is null and nullif(btrim(o.customer_email),'') is null)
   )
 ), aggregate_orders as (
   select customer_key,min(id::text)::uuid as anchor_id,count(*) as order_count,
     count(*) filter(where eligible) as purchases,
     coalesce(sum(total_micros) filter(where eligible),0) as spending,
     min(created_at) filter(where eligible) as first_purchase,max(created_at) filter(where eligible) as last_purchase,
     count(*) filter(where eligible and created_at>=since) as window_purchases,
     coalesce(sum(total_micros) filter(where eligible and created_at>=since),0) as window_spending,
     count(*) filter(where status='cancelled') as cancellations,
     count(*) filter(where payment_status='refunded') as refunds
   from orders_as_of group by customer_key
 ), identities as (
   select 'u:'||pr.id::text as customer_key from public.profiles pr where not pr.is_admin and pr.created_at<as_of and (exact_key is null or 'u:'||pr.id::text=exact_key)
   union select customer_key from aggregate_orders
 ), customers as materialized (
   select i.customer_key as key,
     case when i.customer_key like 'u:%' then 'registered' when i.customer_key like 'e:%' then 'guest_email_group' else 'unidentified_order' end as identity,
     coalesce(nullif(pr.full_name,''),nullif(o.shipping_name,''),'Unnamed customer') as name,
     coalesce(pr.email,o.customer_email) as email,
     pr.created_at as registered_at,a.anchor_id,
     coalesce(a.order_count,0) as orders,coalesce(a.purchases,0) as purchases,coalesce(a.spending,0) as spending,
     coalesce(a.window_purchases,0) as window_purchases,coalesce(a.window_spending,0) as window_spending,
     a.first_purchase,a.last_purchase,coalesce(a.cancellations,0) as cancellations,coalesce(a.refunds,0) as refunds
   from identities i left join aggregate_orders a on a.customer_key=i.customer_key
   left join public.profiles pr on i.customer_key='u:'||pr.id::text
   left join public.orders o on o.id=a.anchor_id
 ), matched as materialized (
   select c.* from customers c where (exact_key is null or c.key=exact_key)
     and (q is null or position(lower(q) in lower(c.name))>0 or position(lower(q) in lower(coalesce(c.email,'')))>0)
     and c.window_purchases>=min_purchases
     and (p_mode<>'top' or c.window_purchases>0)
     and (p_mode<>'inactive' or (c.purchases>0 and c.last_purchase<as_of-make_interval(days=>days)))
     and (p_mode<>'new' or (c.first_purchase>=since and c.first_purchase<as_of))
 ), ranked as (
   select c.*,row_number() over(order by
     case when sort_by='spending' then window_spending end desc,
     case when sort_by='purchases' then window_purchases end desc,
     case when sort_by='newest' then first_purchase end desc nulls last,
     case when sort_by='oldest' then last_purchase end asc nulls last,
     case when sort_by='name' then lower(name) end asc,key) as rn
   from matched c
 ), metrics as (
   select count(*) as customers,count(*) filter(where window_purchases>0) as buyers,
     count(*) filter(where window_purchases>=2) as repeat_buyers,
     count(*) filter(where first_purchase>=since and first_purchase<as_of) as new_buyers,
     count(*) filter(where first_purchase<since and window_purchases>0) as returning_buyers,
     count(*) filter(where purchases>0 and last_purchase<as_of-make_interval(days=>days)) as inactive_buyers,
     count(*) filter(where purchases=0) as not_converted,
     coalesce(sum(window_purchases),0) as purchases,coalesce(sum(window_spending),0) as spending
   from matched
 ), history as (
   select id,order_number,created_at,status,payment_status,total_micros,eligible
   from orders_as_of where customer_key=exact_key and created_at>=since
   order by created_at desc,id desc limit page_size offset (page_no-1)*page_size
 )
 select jsonb_build_object(
   'generatedAt',statement_timestamp(),'mode',p_mode,'baseCurrency','USD',
   'filters',jsonb_build_object('from',since,'to',as_of,'inactiveDays',days,'minPurchases',min_purchases,'limit',page_size,'page',page_no,'sort',sort_by,'search',coalesce(q,''),'customerKey',exact_key),
   'total',case when p_mode='history' then (select count(*) from orders_as_of where customer_key=exact_key and created_at>=since) else (select count(*) from matched) end,
   'metrics',(select to_jsonb(m)||jsonb_build_object('aov',case when m.purchases=0 then null else round(m.spending/m.purchases) end) from metrics m),
   'rows',coalesce((select jsonb_agg(to_jsonb(r)-'rn'-'email' order by r.rn) from ranked r where (p_mode='history' and rn=1) or (p_mode<>'history' and rn between (page_no-1)*page_size+1 and page_no*page_size)),'[]'::jsonb),
   'history',case when p_mode='history' then coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from history h),'[]'::jsonb) else '[]'::jsonb end,
   'detail',case when p_mode='details' then (
     select jsonb_build_object('email',c.email,'phone',coalesce(pr.phone,o.shipping_phone),
       'address',case when o.id is null then null else concat_ws(', ',o.shipping_address_line1,o.shipping_address_line2,o.shipping_city,o.shipping_postal_code,o.shipping_country) end,
       'contactSource','Registered profile when available; otherwise a recorded order. Shipping address is from a representative recorded order, not a verified current address.')
     from matched c left join public.profiles pr on c.key='u:'||pr.id::text
     left join public.orders o on o.id=c.anchor_id limit 1
   ) else null end
 ) into result;
 if abs((result->'metrics'->>'spending')::numeric)>9007199254740991 or exists(select 1 from jsonb_array_elements(result->'rows') r where abs((r->>'spending')::numeric)>9007199254740991 or abs((r->>'window_spending')::numeric)>9007199254740991) or exists(select 1 from jsonb_array_elements(result->'history') h where abs((h->>'total_micros')::numeric)>9007199254740991) then raise exception 'Customer amounts exceed supported exact integer range'; end if;
 return result;
end;
$$;
revoke all on function public.nemesis_customers_read(jsonb,text) from public,anon,authenticated;
grant execute on function public.nemesis_customers_read(jsonb,text) to authenticated;
notify pgrst, 'reload schema';

-- =============================================================================
-- 20261058000000_product_queries.sql
-- (migration 20261058000000_product_queries.sql)
-- =============================================================================

-- Reusable, bounded, read-only catalog queries. No model-generated SQL or writes.
-- Internal fixed-operator evaluator; not exposed through the API.
create function public.nemesis_product_number_matches(n numeric, rule jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
declare op text; value jsonb; threshold numeric; matches boolean := true;
begin
 if rule is null or rule='null'::jsonb then return true; end if;
 if jsonb_typeof(rule)<>'object' then raise exception 'Numeric filter must be an object'; end if;
 for op,value in select * from jsonb_each(rule) loop
   if op not in ('gt','gte','lt','lte','eq','ne') then raise exception 'Unsupported comparison %',op; end if;
   if value='null'::jsonb then continue; end if;
   if jsonb_typeof(value)<>'number' then raise exception 'Comparison requires a number'; end if;
   threshold:=value::numeric;
   if abs(threshold)>9007199254740991 then raise exception 'Comparison is outside supported precision'; end if;
   matches:=matches and coalesce(case op when 'gt' then n>threshold when 'gte' then n>=threshold
     when 'lt' then n<threshold when 'lte' then n<=threshold when 'eq' then n=threshold when 'ne' then n<>threshold end,false);
 end loop;
 return matches;
end $$;
revoke all on function public.nemesis_product_number_matches(numeric,jsonb) from public,anon,authenticated;

create function public.nemesis_products_read(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp
set statement_timeout='15s' as $$
#variable_conflict use_column
declare
 k text; v jsonb; cond jsonb; result jsonb; category_count integer;
 page_no integer:=coalesce((p->>'page')::integer,1); page_size integer:=coalesce((p->>'limit')::integer,10);
 scope text:=coalesce(p->>'scope','products'); state text:=coalesce(p->>'status','all');
 variant_state text:=coalesce(p->>'variationStatus','active'); stock_state text:=coalesce(p->>'stockStatus','all');
 product_type text:=coalesce(p->>'type','all'); sort_by text:=coalesce(p->>'sortBy','name'); direction text:=coalesce(p->>'sortDirection','asc');
 currency_code text; fx numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Filters must be an object'; end if;
 for k,v in select * from jsonb_each(p) loop
   if k not in ('scope','status','variationStatus','stockStatus','type','sortBy','sortDirection','page','limit','currency',
     'stock','price','anyOf','id','productId','ids','search','name','sku','brand','category','categorySlug','categoryId','categorySlugs',
     'featured','onSale','createdFrom','createdTo','updatedFrom','updatedTo') then raise exception 'Unsupported product filter %',k; end if;
   if v='null'::jsonb then continue; end if;
   if k in ('featured','onSale') then
     if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid boolean filter'; end if;
   elsif k in ('stock','price') then perform public.nemesis_product_number_matches(null,v);
   elsif k in ('page','limit') then
     if jsonb_typeof(v)<>'number' or v::numeric<>trunc(v::numeric) then raise exception 'Invalid page/limit'; end if;
   elsif k in ('ids','categorySlugs') then
     if jsonb_typeof(v)<>'array' then raise exception 'Expected a list'; end if;
     if jsonb_array_length(v) not between 1 and 50 then raise exception 'Invalid list length'; end if;
     for cond in select * from jsonb_array_elements(v) loop
       if jsonb_typeof(cond)<>'string' or length(cond#>>'{}') not between 1 and 200 then raise exception 'Invalid list entry'; end if;
       if k='ids' then perform (cond#>>'{}')::uuid; end if;
     end loop;
   elsif k='anyOf' then
     if jsonb_typeof(v)<>'array' then raise exception 'Expected numeric OR list'; end if;
     if jsonb_array_length(v) not between 1 and 10 then raise exception 'Invalid numeric OR list'; end if;
     for cond in select * from jsonb_array_elements(v) loop
       if jsonb_typeof(cond)<>'object' or cond='{}'::jsonb then raise exception 'Empty numeric OR condition'; end if;
       if exists(select 1 from jsonb_object_keys(cond) as x(key) where key not in ('stock','price')) then raise exception 'Unsupported OR filter'; end if;
       perform public.nemesis_product_number_matches(null,cond->'stock');
       perform public.nemesis_product_number_matches(null,cond->'price');
       if not exists(select 1 from jsonb_each(coalesce(nullif(cond->'stock','null'::jsonb),'{}')) where value<>'null'::jsonb)
         and not exists(select 1 from jsonb_each(coalesce(nullif(cond->'price','null'::jsonb),'{}')) where value<>'null'::jsonb) then raise exception 'Empty numeric OR condition'; end if;
     end loop;
   else
     if jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200 then raise exception 'Invalid text filter %',k; end if;
     if k in ('id','productId','categoryId') then perform (v#>>'{}')::uuid; end if;
     if k in ('createdFrom','createdTo','updatedFrom','updatedTo') then perform (v#>>'{}')::timestamptz; end if;
   end if;
 end loop;
 if page_no not between 1 and 10000 or page_size not between 1 and 50 then raise exception 'Invalid pagination'; end if;
 if scope not in ('products','variations','skus') or state not in ('active','draft','all') or variant_state not in ('active','draft','all')
   or stock_state not in ('all','tracked','untracked','in_stock','out_of_stock') or product_type not in ('all','simple','variable')
   or sort_by not in ('name','stock','price','created_at','updated_at') or direction not in ('asc','desc') then raise exception 'Invalid query option'; end if;
 if scope='products' and variant_state<>'active' then raise exception 'variationStatus only applies to variation scope'; end if;
 if (p->>'createdFrom')::timestamptz >= (p->>'createdTo')::timestamptz or (p->>'updatedFrom')::timestamptz >= (p->>'updatedTo')::timestamptz then raise exception 'Invalid date range'; end if;
 -- Unknown categories must never drop a filter and broaden a read.
 if p->>'category' is not null then
   select count(*) into category_count from public.categories c where lower(c.name)=lower(p->>'category') or lower(c.slug)=lower(p->>'category');
   if category_count<>1 then raise exception 'Category missing or ambiguous; use an exact slug or ID'; end if;
 end if;
 if p->>'categorySlug' is not null and not exists(select 1 from public.categories c where c.slug=p->>'categorySlug') then raise exception 'Unknown category slug'; end if;
 if p->>'categoryId' is not null and not exists(select 1 from public.categories c where c.id=(p->>'categoryId')::uuid) then raise exception 'Unknown category ID'; end if;
 if p->'categorySlugs' is not null and p->'categorySlugs'<>'null'::jsonb and exists(
   select 1 from jsonb_array_elements_text(coalesce(nullif(p->'categorySlugs','null'::jsonb),'[]'::jsonb)) s(slug) where not exists(select 1 from public.categories c where c.slug=s.slug)
 ) then raise exception 'Unknown category in categorySlugs'; end if;
 select coalesce(p->>'currency',case when s.currency='BDT' and s.usd_to_bdt_rate>0 then 'BDT' else 'USD' end),s.usd_to_bdt_rate
   into currency_code,fx from public.site_settings s where s.id=1;
 currency_code:=coalesce(currency_code,p->>'currency','USD');
 if currency_code not in ('USD','BDT') then raise exception 'Unsupported currency'; end if;
 if currency_code='USD' then fx:=1; elsif fx is null or fx<=0 then raise exception 'Configure USD to BDT rate before querying BDT prices'; end if;

 with base as materialized (
   select pr.id,pr.name,pr.slug,pr.sku,pr.brand,pr.type,pr.manage_stock,pr.stock,pr.price_micros,pr.compare_at_price_micros,
     pr.is_active,pr.is_featured,pr.created_at,pr.updated_at,pr.image_url,pr.image_media_id,c.name as category,c.slug as category_slug
   from public.products pr left join public.categories c on c.id=pr.category_id
   where (state='all' or pr.is_active=(state='active')) and (product_type='all' or pr.type=product_type)
     and (p->>'productId' is null or pr.id=(p->>'productId')::uuid)
     and (p->>'brand' is null or lower(pr.brand)=lower(p->>'brand'))
     and (p->>'featured' is null or pr.is_featured=(p->>'featured')::boolean)
     and (p->>'category' is null or lower(c.name)=lower(p->>'category') or lower(c.slug)=lower(p->>'category'))
     and (p->>'categorySlug' is null or c.slug=p->>'categorySlug')
     and (p->>'categoryId' is null or c.id=(p->>'categoryId')::uuid)
     and (p->'categorySlugs' is null or p->'categorySlugs'='null'::jsonb or c.slug in(select jsonb_array_elements_text(coalesce(nullif(p->'categorySlugs','null'::jsonb),'[]'::jsonb))))
 ), variants as materialized (
   select pv.* from public.product_variations pv join base b on b.id=pv.product_id where b.type='variable'
 ), aggregates as (
   select product_id,sum(stock) filter(where is_active) as stock,min(price_micros) filter(where is_active) as price,
     bool_or(compare_at_price_micros>price_micros) filter(where is_active) as on_sale
   from variants group by product_id
 ), catalog as (
   select b.id,b.id as product_id,null::uuid as variation_id,b.name,b.name as product_name,b.slug,b.sku,b.brand,b.type,b.category,b.category_slug,
     case when b.manage_stock then case when b.type='variable' then coalesce(a.stock,0) else b.stock end end as stock,
     b.manage_stock as stock_managed,case when b.type='variable' then a.price else b.price_micros end as price_micros,
     case when b.type='variable' then null else b.compare_at_price_micros end as compare_at_price_micros,
     coalesce(case when b.type='variable' then a.on_sale else b.compare_at_price_micros>b.price_micros end,false) as on_sale,
     b.is_featured as featured,case when b.is_active then 'active' else 'draft' end as status,null::text as variation_status,
     b.created_at,b.updated_at,b.image_url,b.image_media_id,
     lower(concat_ws(' ',b.name,b.slug,b.sku,b.brand,(select string_agg(concat_ws(' ',v.sku,v.label),' ') from variants v where v.product_id=b.id and v.is_active))) as search_text
   from base b left join aggregates a on a.product_id=b.id where scope in ('products','skus') and (scope='products' or b.type='simple')
     and (p->>'sku' is null or lower(b.sku)=lower(p->>'sku') or exists(select 1 from variants v where v.product_id=b.id and v.is_active and lower(v.sku)=lower(p->>'sku')))
   union all
   select v.id,b.id,v.id,b.name||case when v.label<>'' then ' — '||v.label else '' end,b.name,b.slug,v.sku,b.brand,b.type,b.category,b.category_slug,
     case when b.manage_stock then v.stock end,b.manage_stock,v.price_micros,v.compare_at_price_micros,
     coalesce(v.compare_at_price_micros>v.price_micros,false),b.is_featured,case when b.is_active then 'active' else 'draft' end,
     case when v.is_active then 'active' else 'draft' end,v.created_at,v.updated_at,coalesce(v.image_url,b.image_url),coalesce(v.image_media_id,b.image_media_id),
     lower(concat_ws(' ',b.name,b.slug,b.brand,v.sku,v.label))
   from variants v join base b on b.id=v.product_id where scope in ('variations','skus') and (variant_state='all' or v.is_active=(variant_state='active'))
     and (p->>'sku' is null or lower(v.sku)=lower(p->>'sku'))
 ), priced as (
   -- Compare what the administrator sees (rounded cents/poisha), not raw FX micros.
   select c.*,round(c.price_micros::numeric*fx/10000)/100 as display_price from catalog c
 ), matched as materialized (
   select c.* from priced c where (p->>'id' is null or c.id=(p->>'id')::uuid)
     and (p->'ids' is null or p->'ids'='null'::jsonb or c.id in(select value::uuid from jsonb_array_elements_text(coalesce(nullif(p->'ids','null'::jsonb),'[]'::jsonb))))
     and (p->>'name' is null or position(lower(p->>'name') in lower(c.name))>0)
     and (p->>'search' is null or position(lower(p->>'search') in c.search_text)>0)
     and (p->>'onSale' is null or c.on_sale=(p->>'onSale')::boolean)
     and (stock_state='all' or (stock_state='tracked' and c.stock_managed) or (stock_state='untracked' and not c.stock_managed)
       or (stock_state='in_stock' and c.stock>0) or (stock_state='out_of_stock' and c.stock=0))
     and public.nemesis_product_number_matches(c.stock,p->'stock') and public.nemesis_product_number_matches(c.display_price,p->'price')
     and (p->'anyOf' is null or p->'anyOf'='null'::jsonb or exists(select 1 from jsonb_array_elements(coalesce(nullif(p->'anyOf','null'::jsonb),'[]'::jsonb)) x(cond)
       where public.nemesis_product_number_matches(c.stock,cond->'stock') and public.nemesis_product_number_matches(c.display_price,cond->'price')))
     and (p->>'createdFrom' is null or c.created_at>=(p->>'createdFrom')::timestamptz)
     and (p->>'createdTo' is null or c.created_at<(p->>'createdTo')::timestamptz)
     and (p->>'updatedFrom' is null or c.updated_at>=(p->>'updatedFrom')::timestamptz)
     and (p->>'updatedTo' is null or c.updated_at<(p->>'updatedTo')::timestamptz)
 ), ranked as (
   select c.*,row_number() over(order by
     case when sort_by='name' and direction='asc' then lower(c.name) end asc nulls last,
     case when sort_by='name' and direction='desc' then lower(c.name) end desc nulls last,
     case when sort_by='stock' and direction='asc' then c.stock end asc nulls last,
     case when sort_by='stock' and direction='desc' then c.stock end desc nulls last,
     case when sort_by='price' and direction='asc' then c.display_price end asc nulls last,
     case when sort_by='price' and direction='desc' then c.display_price end desc nulls last,
     case when sort_by='created_at' and direction='asc' then c.created_at when sort_by='updated_at' and direction='asc' then c.updated_at end asc nulls last,
     case when sort_by='created_at' and direction='desc' then c.created_at when sort_by='updated_at' and direction='desc' then c.updated_at end desc nulls last,c.id) as rn
   from matched c
 ), page_rows as (
   select r.*,m.path as image_path from ranked r left join public.media m on m.id=r.image_media_id
   where rn>(page_no-1)*page_size and rn<=page_no*page_size
 )
 select jsonb_build_object('generatedAt',statement_timestamp(),'filters',p,'money',jsonb_build_object('currency',currency_code,'rate',fx),
   'total',(select count(*) from matched),'hasMore',(select count(*) from matched)>page_no*page_size,
   'metrics',(select jsonb_build_object('tracked',count(*) filter(where stock_managed),'untracked',count(*) filter(where not stock_managed),
     'trackedUnits',coalesce(sum(stock),0),'outOfStock',count(*) filter(where stock=0),'lowStock',count(*) filter(where stock between 1 and 3)) from matched),
   'rows',coalesce((select jsonb_agg(to_jsonb(r)-'rn'-'search_text'-'display_price'-'image_media_id' order by rn) from page_rows r),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.nemesis_products_read(jsonb) from public,anon;
grant execute on function public.nemesis_products_read(jsonb) to authenticated;
comment on function public.nemesis_products_read(jsonb) is 'Admin-only read-only full-catalog filters, exact cohort metrics and bounded product/variation pages. No cost/private financial fields.';

-- =============================================================================
-- 20261059000000_typography.sql
-- (migration 20261059000000_typography.sql)
-- =============================================================================

-- Reuse the singleton settings row; NULL/legacy configurations use app defaults.
-- Existing theme, currency and customer data are untouched.
alter table public.site_settings add column if not exists typography jsonb;
alter table public.site_settings add constraint site_settings_typography_valid check (
 typography is null or (typography=jsonb_build_object('store',jsonb_build_object('title',typography#>>'{store,title}','body',typography#>>'{store,body}','button',typography#>>'{store,button}'),'admin',jsonb_build_object('title',typography#>>'{admin,title}','body',typography#>>'{admin,body}','button',typography#>>'{admin,button}'))
 and jsonb_path_query_array(typography,'$.*.*') <@ '["Inter", "Poppins", "Roboto", "DM Sans", "Montserrat", "Plus Jakarta Sans", "Open Sans", "Lato", "Playfair Display", "Manrope", "Outfit", "Nunito Sans", "Lora", "Source Sans 3", "Work Sans", "Rubik", "Sora", "Space Grotesk", "Oswald", "Merriweather", "Geist", "IBM Plex Sans", "Public Sans"]'::jsonb)
);
comment on column public.site_settings.typography is 'Independent store/admin title, body and button font names; whitelisted self-hosted families. NULL uses application defaults.';

-- Atomic partial-scope merge: saving Store never overwrites a concurrent Admin save.
-- SECURITY INVOKER retains existing admin-only UPDATE RLS on site_settings.
create function public.save_typography(p jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp
set statement_timeout='10s' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or p='{}'::jsonb then raise exception 'Invalid typography changes'; end if;
 if exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('store','admin')) then raise exception 'Unknown typography scope'; end if;
 update public.site_settings set typography=coalesce(typography,'{"store": {"title": "Plus Jakarta Sans", "body": "Inter", "button": "Inter"}, "admin": {"title": "Inter", "body": "Inter", "button": "Inter"}}'::jsonb)||p where id=1 returning typography into result;
 if not found then raise exception 'Settings record is missing'; end if;
 return result;
end $$;
revoke all on function public.save_typography(jsonb) from public,anon;
grant execute on function public.save_typography(jsonb) to authenticated;

-- Opt this non-secret configuration into the existing client bootstrap export.
do $$ begin
 if to_regclass('public.client_setup_fields') is not null then
   insert into public.client_setup_fields(table_name,column_name) values('site_settings','typography') on conflict do nothing;
 end if;
end $$;

-- =============================================================================
-- 20261060000000_static_homepage.sql
-- (migration 20261060000000_static_homepage.sql)
-- =============================================================================

-- NULL keeps the current storefront. Stable identity survives page slug changes;
-- deletion restores the default without retaining a dangling reference.
alter table public.site_settings
  add column if not exists home_page_id uuid references public.pages(id) on delete set null;
comment on column public.site_settings.home_page_id is
  'Published CMS page rendered at /; NULL uses the built-in storefront. Draft/missing pages fall back at runtime.';
-- Do not add this content-specific foreign key to client_setup_fields: exported
-- client setups intentionally do not contain the source store's page rows.

-- =============================================================================
-- 20261061000000_coupons_reviews.sql
-- (migration 20261061000000_coupons_reviews.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – coupons & product reviews
--
--  COUPONS
--    coupons             one row per promo code: percent or fixed-amount
--                        discount, optional free shipping, minimum spend,
--                        max-discount cap, optional start/expiry, total and
--                        per-customer usage limits, first-order-only flag and
--                        a scope (whole order / sale categories / products).
--    coupon_redemptions  one row per order that used a coupon (the ledger
--                        behind the per-customer limits; cancelling the
--                        order releases the redemption again).
--    orders gains `discount_micros`, `coupon_code` and `coupon_id`.
--    `place_order(jsonb, jsonb, text)` re-prices AND re-validates the coupon
--    server-side (the 2-argument version is dropped), and `preview_coupon()`
--    prices a cart without placing anything so the cart/checkout can show
--    the saving instantly. Coupon rows are never readable by customers –
--    only these two SECURITY DEFINER functions look a code up.
--
--  REVIEWS
--    product_reviews     rating 1–5, title, body, moderation status, a
--                        verified-purchase flag computed from completed
--                        orders, an author snapshot (like order_messages),
--                        a store response and a denormalised helpful count.
--                        Verified purchases publish immediately; every other
--                        review waits for an admin in Nemesis → Reviews.
--    review_helpful_votes one vote per customer per review (toggle RPC).
--    product_rating_stats view behind the stars on cards / product pages.
--    New *pending* reviews notify every admin (kind `product_review`).
--
--  Run in the Supabase SQL Editor *after* 20261060000000_static_homepage.sql,
--  together with the matching app release (checkout calls the new
--  3-argument `place_order`). Idempotent where practical: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. COUPONS
-- -----------------------------------------------------------------------------
create table if not exists public.coupons (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null check (length(trim(code)) between 3 and 40),
  description          text check (description is null or length(description) <= 200),
  discount_type        text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  percent_off          numeric(5, 2),
  amount_off_micros    bigint,
  max_discount_micros  bigint check (max_discount_micros is null or max_discount_micros >= 0),
  min_subtotal_micros  bigint not null default 0 check (min_subtotal_micros >= 0),
  free_shipping        boolean not null default false,
  scope_type           text not null default 'all' check (scope_type in ('all', 'categories', 'products')),
  scope_ids            uuid[] not null default '{}',
  first_order_only     boolean not null default false,
  starts_at            timestamptz,
  expires_at           timestamptz,
  usage_limit          integer check (usage_limit is null or usage_limit > 0),
  per_user_limit       integer not null default 1 check (per_user_limit > 0),
  times_redeemed       integer not null default 0 check (times_redeemed >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (
    (discount_type = 'percent' and percent_off > 0 and percent_off <= 100 and amount_off_micros is null)
    or (discount_type = 'fixed' and amount_off_micros > 0 and percent_off is null)
    or (free_shipping and percent_off is null and amount_off_micros is null)
  ),
  check (starts_at is null or expires_at is null or expires_at > starts_at),
  check (scope_type = 'all' or cardinality(scope_ids) > 0)
);

create unique index if not exists coupons_code_upper_idx on public.coupons (upper(code));
create index if not exists coupons_active_idx on public.coupons (is_active, expires_at);

comment on table public.coupons is 'Promo codes managed under Nemesis → Coupons (admin-only reads; checkout uses SECURITY DEFINER RPCs)';
comment on column public.coupons.scope_ids is 'Category or product ids the discount is limited to when scope_type <> ''all''';

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  order_id        uuid not null unique references public.orders (id) on delete cascade,
  discount_micros bigint not null default 0 check (discount_micros >= 0),
  released_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_user_active_idx
  on public.coupon_redemptions (user_id, coupon_id) where released_at is null;

comment on table public.coupon_redemptions is 'One row per order that redeemed a coupon; released_at is stamped when the order is cancelled';

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists "Admins can manage coupons" on public.coupons;
create policy "Admins can manage coupons"
  on public.coupons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage coupon redemptions" on public.coupon_redemptions;
create policy "Admins can manage coupon redemptions"
  on public.coupon_redemptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Customers can read their own coupon redemptions" on public.coupon_redemptions;
create policy "Customers can read their own coupon redemptions"
  on public.coupon_redemptions for select to authenticated
  using (user_id = auth.uid());

revoke all on public.coupons from anon;
revoke all on public.coupon_redemptions from anon;
grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;
grant all on public.coupons to service_role;
grant all on public.coupon_redemptions to service_role;

-- -----------------------------------------------------------------------------
--  2. ORDERS remember the coupon they were placed with
-- -----------------------------------------------------------------------------
alter table public.orders
  add column if not exists discount_micros bigint not null default 0,
  add column if not exists coupon_code text,
  add column if not exists coupon_id uuid references public.coupons (id) on delete set null;

alter table public.orders drop constraint if exists orders_discount_nonnegative;
alter table public.orders add constraint orders_discount_nonnegative check (discount_micros >= 0);

comment on column public.orders.discount_micros is 'Coupon discount in USD micros, already subtracted inside total_micros';
comment on column public.orders.coupon_code is 'Snapshot of the redeemed code (survives the coupon being renamed/deleted)';

-- -----------------------------------------------------------------------------
--  3. PRODUCT REVIEWS
-- -----------------------------------------------------------------------------
create table if not exists public.product_reviews (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  user_id              uuid references public.profiles (id) on delete set null,
  author_name          text not null default 'Customer',
  author_avatar_url    text,
  rating               integer not null check (rating between 1 and 5),
  title                text check (title is null or length(title) <= 120),
  body                 text not null check (length(trim(body)) between 1 and 2000),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_verified_purchase boolean not null default false,
  helpful_count        integer not null default 0 check (helpful_count >= 0),
  response_text        text check (response_text is null or length(response_text) <= 1000),
  response_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists product_reviews_product_user_idx
  on public.product_reviews (product_id, user_id) where user_id is not null;
create index if not exists product_reviews_product_status_idx
  on public.product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_status_idx
  on public.product_reviews (status, created_at desc);

comment on table public.product_reviews is 'Customer reviews; verified purchases auto-approve, the rest wait in Nemesis → Reviews';
comment on column public.product_reviews.author_name is 'Snapshot at submission time, so the review keeps rendering after a profile edit/deletion';

drop trigger if exists product_reviews_set_updated_at on public.product_reviews;
create trigger product_reviews_set_updated_at
  before update on public.product_reviews
  for each row execute function public.set_updated_at();

create table if not exists public.review_helpful_votes (
  review_id  uuid not null references public.product_reviews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

alter table public.product_reviews enable row level security;
alter table public.review_helpful_votes enable row level security;

drop policy if exists "Approved reviews are viewable by everyone" on public.product_reviews;
create policy "Approved reviews are viewable by everyone"
  on public.product_reviews for select
  using (status = 'approved' or user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can moderate reviews" on public.product_reviews;
create policy "Admins can moderate reviews"
  on public.product_reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Customers can read their own helpful votes" on public.review_helpful_votes;
create policy "Customers can read their own helpful votes"
  on public.review_helpful_votes for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.product_reviews to anon, authenticated;
grant update, delete on public.product_reviews to authenticated;
grant select on public.review_helpful_votes to authenticated;
grant all on public.product_reviews to service_role;
grant all on public.review_helpful_votes to service_role;

-- helpful_count follows the votes table
create or replace function public.sync_review_helpful_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.product_reviews set helpful_count = helpful_count + 1 where id = new.review_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.product_reviews set helpful_count = greatest(helpful_count - 1, 0) where id = old.review_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists review_helpful_votes_sync_count on public.review_helpful_votes;
create trigger review_helpful_votes_sync_count
  after insert or delete on public.review_helpful_votes
  for each row execute function public.sync_review_helpful_count();

-- Stars on cards / product pages read this (approved reviews only)
create or replace view public.product_rating_stats as
  select product_id,
         count(*)::integer as review_count,
         round(avg(rating)::numeric, 2) as avg_rating
    from public.product_reviews
   where status = 'approved'
   group by product_id;

grant select on public.product_rating_stats to anon, authenticated;

-- -----------------------------------------------------------------------------
--  4. NOTIFICATIONS: pending reviews reach every admin
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('new_order', 'order_status', 'order_cancelled', 'payment', 'order_message', 'product_review'));

create or replace function public.notify_admins_new_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_name text;
begin
  if new.status <> 'pending' then
    return new;
  end if;
  select name into v_product_name from public.products where id = new.product_id;
  insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
  select a.id, 'product_review',
         'New review to moderate',
         left(coalesce(nullif(new.title, ''), new.body), 140),
         '/nemesis/reviews', null,
         coalesce(v_product_name, new.author_name)
    from public.notification_admins(new.user_id) as a(id);
  return new;
end $$;

drop trigger if exists product_reviews_notify_admins on public.product_reviews;
create trigger product_reviews_notify_admins
  after insert on public.product_reviews
  for each row execute function public.notify_admins_new_review();

-- -----------------------------------------------------------------------------
--  5. COUPON PRICING (shared maths for preview + checkout)
-- -----------------------------------------------------------------------------
create or replace function public.coupon_discount_for(p_coupon public.coupons, p_eligible_micros bigint)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  v_discount bigint := 0;
begin
  if coalesce(p_eligible_micros, 0) <= 0 then
    return 0;
  end if;
  if p_coupon.discount_type = 'percent' and p_coupon.percent_off is not null then
    v_discount := floor(p_eligible_micros * p_coupon.percent_off / 100)::bigint;
  elsif p_coupon.discount_type = 'fixed' and p_coupon.amount_off_micros is not null then
    v_discount := least(p_coupon.amount_off_micros, p_eligible_micros);
  end if;
  if p_coupon.max_discount_micros is not null then
    v_discount := least(v_discount, p_coupon.max_discount_micros);
  end if;
  return greatest(least(v_discount, p_eligible_micros), 0);
end $$;

revoke all on function public.coupon_discount_for(public.coupons, bigint) from public;

-- Prices a cart and validates a code without placing anything. Readable answers
-- only: an unknown code and an expired code look the same from the outside.
create or replace function public.preview_coupon(p_code text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
  v_coupon public.coupons%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_variation_id uuid;
  v_qty integer;
  v_price bigint;
  v_subtotal bigint := 0;
  v_eligible bigint := 0;
  v_discount bigint := 0;
  v_shipping bigint := 0;
  v_used integer;
begin
  if v_code is null then
    return jsonb_build_object('ok', false, 'message', 'Enter a coupon code.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Your cart is empty.');
  end if;

  select * into v_coupon from public.coupons where upper(code) = v_code;
  if not found or not v_coupon.is_active
     or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
     or (v_coupon.expires_at is not null and v_coupon.expires_at <= now())
     or (v_coupon.usage_limit is not null and v_coupon.times_redeemed >= v_coupon.usage_limit) then
    return jsonb_build_object('ok', false, 'message', 'That coupon code is not valid.');
  end if;

  if v_user_id is not null then
    select count(*) into v_used
      from public.coupon_redemptions
     where coupon_id = v_coupon.id and user_id = v_user_id and released_at is null;
    if v_used >= v_coupon.per_user_limit then
      return jsonb_build_object('ok', false, 'message', 'You have already used this coupon.');
    end if;
    if v_coupon.first_order_only and exists (
      select 1 from public.orders where user_id = v_user_id and status <> 'cancelled'
    ) then
      return jsonb_build_object('ok', false, 'message', 'This coupon is for first orders only.');
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    if v_qty <= 0 then
      return jsonb_build_object('ok', false, 'message', 'Invalid quantity in your cart.');
    end if;

    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::uuid and is_active = true;
    if not found then
      return jsonb_build_object('ok', false, 'message', 'A product in your cart is no longer available.');
    end if;

    v_variation_id := nullif(coalesce(v_item ->> 'variation_id', ''), '')::uuid;
    if v_product.type = 'variable' and v_variation_id is null then
      return jsonb_build_object('ok', false, 'message', 'Choose an available variation in your cart first.');
    end if;
    if v_variation_id is not null then
      select price_micros into v_price from public.product_variations
       where id = v_variation_id and product_id = v_product.id and is_active;
      if v_price is null then
        return jsonb_build_object('ok', false, 'message', 'An option in your cart is no longer available.');
      end if;
    else
      v_price := v_product.price_micros;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    if v_coupon.scope_type = 'all'
       or (v_coupon.scope_type = 'categories' and v_product.category_id = any (v_coupon.scope_ids))
       or (v_coupon.scope_type = 'products' and v_product.id = any (v_coupon.scope_ids)) then
      v_eligible := v_eligible + v_price * v_qty;
    end if;
  end loop;

  if v_eligible <= 0 then
    return jsonb_build_object('ok', false, 'message', 'This coupon does not apply to the items in your cart.');
  end if;
  if v_eligible < v_coupon.min_subtotal_micros then
    return jsonb_build_object('ok', false, 'message', 'Your cart does not reach the minimum spend for this coupon.');
  end if;

  v_discount := public.coupon_discount_for(v_coupon, v_eligible);
  if v_discount <= 0 and not v_coupon.free_shipping then
    return jsonb_build_object('ok', false, 'message', 'This coupon does not apply to the items in your cart.');
  end if;

  v_shipping := case when v_coupon.free_shipping then 0 else public.calculate_shipping(v_subtotal - v_discount) end;

  return jsonb_build_object(
    'ok', true,
    'code', v_coupon.code,
    'description', v_coupon.description,
    'discount_type', v_coupon.discount_type,
    'percent_off', v_coupon.percent_off,
    'amount_off_micros', v_coupon.amount_off_micros,
    'free_shipping', v_coupon.free_shipping,
    'discount_micros', v_discount,
    'subtotal_micros', v_subtotal,
    'eligible_micros', v_eligible,
    'shipping_micros', v_shipping,
    'total_micros', v_subtotal - v_discount + v_shipping,
    'expires_at', v_coupon.expires_at
  );
end $$;

revoke all on function public.preview_coupon(text, jsonb) from public;
grant execute on function public.preview_coupon(text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
--  6. PLACE ORDER – the 20261027000000 body (with the 20261050000000
--     per-product stock patch applied) plus coupon redemption. The old
--     2-argument signature is dropped at the end of this migration.
-- -----------------------------------------------------------------------------
create or replace function public.place_order(p_items jsonb, p_shipping jsonb, p_coupon_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_email       text;
  v_order_id    uuid;
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_variation   public.product_variations%rowtype;
  v_variation_id uuid;
  v_qty         integer;
  v_price       bigint;
  v_stock       integer;
  v_label       text;
  v_subtotal    bigint := 0;
  v_shipping    bigint;
  v_managed     boolean;
  v_currency    text := 'USD';
  v_rate        numeric := 1;
  v_coupon      public.coupons%rowtype;
  v_coupon_code text := nullif(upper(trim(coalesce(p_coupon_code, ''))), '');
  v_eligible    bigint := 0;
  v_discount    bigint := 0;
  v_used        integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  if coalesce(p_shipping ->> 'name', '') = ''
     or coalesce(p_shipping ->> 'address_line1', '') = ''
     or coalesce(p_shipping ->> 'city', '') = ''
     or coalesce(p_shipping ->> 'country', '') = '' then
    raise exception 'Please fill in all required shipping fields.';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  -- the currency the customer is looking at right now (BDT only with a usable rate)
  select case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then 'BDT' else 'USD' end,
         case when s.currency = 'BDT' and coalesce(s.usd_to_bdt_rate, 0) > 0 then s.usd_to_bdt_rate else 1 end
    into v_currency, v_rate
    from public.site_settings s
   where s.id = 1;
  if v_currency is null then
    v_currency := 'USD';
    v_rate := 1;
  end if;

  -- lock the coupon row first so concurrent checkouts cannot race its limits
  if v_coupon_code is not null then
    select * into v_coupon from public.coupons where upper(code) = v_coupon_code for update;
    if not found or not v_coupon.is_active
       or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
       or (v_coupon.expires_at is not null and v_coupon.expires_at <= now())
       or (v_coupon.usage_limit is not null and v_coupon.times_redeemed >= v_coupon.usage_limit) then
      raise exception 'That coupon code is not valid.';
    end if;

    select count(*) into v_used
      from public.coupon_redemptions
     where coupon_id = v_coupon.id and user_id = v_user_id and released_at is null;
    if v_used >= v_coupon.per_user_limit then
      raise exception 'You have already used this coupon.';
    end if;

    if v_coupon.first_order_only and exists (
      select 1 from public.orders where user_id = v_user_id and status <> 'cancelled'
    ) then
      raise exception 'This coupon is for first orders only.';
    end if;
  end if;

  insert into public.orders (
    user_id, customer_email, payment_method,
    shipping_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_postal_code, shipping_country,
    notes, currency, exchange_rate
  ) values (
    v_user_id, v_email, 'cod',
    p_shipping ->> 'name', nullif(p_shipping ->> 'phone', ''),
    p_shipping ->> 'address_line1', nullif(p_shipping ->> 'address_line2', ''),
    p_shipping ->> 'city', nullif(p_shipping ->> 'postal_code', ''), p_shipping ->> 'country',
    nullif(p_shipping ->> 'notes', ''), v_currency, v_rate
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    -- lock the product row so concurrent checkouts cannot oversell
    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    v_managed := v_product.manage_stock;
    v_variation_id := nullif(coalesce(v_item ->> 'variation_id', ''), '')::uuid;
    v_label        := null;
    if v_product.type = 'variable' and v_variation_id is null then
      raise exception 'Choose an available variation for %.', v_product.name;
    end if;
    if v_product.type <> 'variable' and v_variation_id is not null then
      raise exception 'This product does not have variations.';
    end if;

    if v_variation_id is not null then
      -- a variable product: price and stock come from the chosen combination
      select * into v_variation
      from public.product_variations
      where id = v_variation_id
        and product_id = v_product.id
        and is_active
      for update;

      if not found then
        raise exception 'That option of % is no longer available.', v_product.name;
      end if;

      v_price := v_variation.price_micros;
      v_stock := v_variation.stock;
      v_label := coalesce(nullif(v_variation.label, ''), 'Selected option');

      if v_managed and v_stock < v_qty then
        raise exception 'Only % left of % – %.', v_stock, v_product.name, v_label;
      end if;

      insert into public.order_items (
        order_id, product_id, product_name, product_slug, image_url,
        unit_price_micros, quantity, variation_id, variation_label, stock_deducted
      ) values (
        v_order_id, v_product.id, v_product.name, v_product.slug,
        coalesce(v_variation.image_url, v_product.image_url),
        v_price, v_qty, v_variation.id, v_label, v_managed
      );

      if v_managed then
        update public.product_variations set stock = stock - v_qty where id = v_variation.id;
      end if;
    else
      v_price := v_product.price_micros;
      v_stock := v_product.stock;

      if v_managed and v_stock < v_qty then
        raise exception 'Only % left of %.', v_stock, v_product.name;
      end if;

      insert into public.order_items (
        order_id, product_id, product_name, product_slug, image_url, unit_price_micros, quantity, stock_deducted
      ) values (
        v_order_id, v_product.id, v_product.name, v_product.slug,
        v_product.image_url, v_price, v_qty, v_managed
      );

      if v_managed then
        update public.products set stock = stock - v_qty where id = v_product.id;
      end if;
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    if v_coupon_code is not null and (
      v_coupon.scope_type = 'all'
      or (v_coupon.scope_type = 'categories' and v_product.category_id = any (v_coupon.scope_ids))
      or (v_coupon.scope_type = 'products' and v_product.id = any (v_coupon.scope_ids))
    ) then
      v_eligible := v_eligible + v_price * v_qty;
    end if;
  end loop;

  if v_coupon_code is not null then
    if v_eligible <= 0 then
      raise exception 'This coupon does not apply to the items in your cart.';
    end if;
    if v_eligible < v_coupon.min_subtotal_micros then
      raise exception 'Your cart does not reach the minimum spend for this coupon.';
    end if;
    v_discount := public.coupon_discount_for(v_coupon, v_eligible);
    if v_discount <= 0 and not v_coupon.free_shipping then
      raise exception 'This coupon does not apply to the items in your cart.';
    end if;
  end if;

  v_shipping := case
    when v_coupon_code is not null and v_coupon.free_shipping then 0
    else public.calculate_shipping(v_subtotal - v_discount)
  end;

  update public.orders
     set subtotal_micros = v_subtotal,
         discount_micros = v_discount,
         coupon_code     = case when v_coupon_code is not null then v_coupon.code else null end,
         coupon_id       = case when v_coupon_code is not null then v_coupon.id else null end,
         shipping_micros = v_shipping,
         total_micros    = v_subtotal - v_discount + v_shipping
   where id = v_order_id;

  if v_coupon_code is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_micros)
    values (v_coupon.id, v_user_id, v_order_id, v_discount);
    update public.coupons set times_redeemed = times_redeemed + 1 where id = v_coupon.id;
  end if;

  return v_order_id;
end $$;

revoke all on function public.place_order(jsonb, jsonb, text) from public;
grant execute on function public.place_order(jsonb, jsonb, text) to authenticated;

-- one checkout entry point only (deploy this migration with the app release)
drop function if exists public.place_order(jsonb, jsonb);

-- Cancelling an order gives the coupon use back
create or replace function public.release_coupon_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon_id uuid;
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    for v_coupon_id in
      update public.coupon_redemptions
         set released_at = now()
       where order_id = new.id and released_at is null
      returning coupon_id
    loop
      update public.coupons
         set times_redeemed = greatest(times_redeemed - 1, 0)
       where id = v_coupon_id;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists orders_release_coupon_on_cancel on public.orders;
create trigger orders_release_coupon_on_cancel
  after update of status on public.orders
  for each row execute function public.release_coupon_on_cancel();

-- -----------------------------------------------------------------------------
--  7. REVIEW SUBMISSION + HELPFUL VOTES (the storefront's only write paths)
-- -----------------------------------------------------------------------------
create or replace function public.submit_product_review(p_product_id uuid, p_rating integer, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := nullif(left(trim(coalesce(p_title, '')), 120), '');
  v_body text := left(trim(coalesce(p_body, '')), 2000);
  v_name text;
  v_avatar text;
  v_verified boolean := false;
  v_review public.product_reviews%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to write a review.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a star rating.';
  end if;
  if length(v_body) < 3 then
    raise exception 'Please write a little more about the product.';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and is_active) then
    raise exception 'That product is no longer available.';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Customer'), avatar_url
    into v_name, v_avatar
    from public.profiles where id = v_user_id;

  v_verified := exists (
    select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
     where o.user_id = v_user_id and o.status = 'completed' and oi.product_id = p_product_id
  );

  insert into public.product_reviews (
    product_id, user_id, author_name, author_avatar_url, rating, title, body,
    status, is_verified_purchase
  ) values (
    p_product_id, v_user_id, coalesce(v_name, 'Customer'), v_avatar, p_rating, v_title, v_body,
    case when v_verified then 'approved' else 'pending' end, v_verified
  )
  on conflict (product_id, user_id) where user_id is not null
  do update set rating = excluded.rating,
                title = excluded.title,
                body = excluded.body,
                author_name = excluded.author_name,
                author_avatar_url = excluded.author_avatar_url,
                status = excluded.status,
                is_verified_purchase = excluded.is_verified_purchase
  returning * into v_review;

  return to_jsonb(v_review);
end $$;

revoke all on function public.submit_product_review(uuid, integer, text, text) from public;
grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;

create or replace function public.toggle_review_helpful(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.product_reviews%rowtype;
  v_helpful boolean;
begin
  if v_user_id is null then
    raise exception 'Please sign in to vote.';
  end if;
  select * into v_review from public.product_reviews where id = p_review_id and status = 'approved';
  if not found then
    raise exception 'That review is no longer available.';
  end if;
  if v_review.user_id = v_user_id then
    raise exception 'You cannot vote on your own review.';
  end if;

  if exists (select 1 from public.review_helpful_votes where review_id = p_review_id and user_id = v_user_id) then
    delete from public.review_helpful_votes where review_id = p_review_id and user_id = v_user_id;
    v_helpful := false;
  else
    insert into public.review_helpful_votes (review_id, user_id) values (p_review_id, v_user_id);
    v_helpful := true;
  end if;

  select helpful_count into v_review.helpful_count from public.product_reviews where id = p_review_id;
  return jsonb_build_object('helpful', v_helpful, 'helpful_count', coalesce(v_review.helpful_count, 0));
end $$;

revoke all on function public.toggle_review_helpful(uuid) from public;
grant execute on function public.toggle_review_helpful(uuid) to authenticated;

notify pgrst, 'reload schema';



-- =============================================================================
-- 20261062000000_reviews_toggle.sql
-- (migration 20261062000000_reviews_toggle.sql)
-- =============================================================================

-- =============================================================================
--  Woo Solution – Ratings & Reviews feature toggle
--
--  Adds `site_settings.reviews_enabled` for Nemesis → E-commerce → General.
--  While false, approved reviews and rating aggregates are hidden from the
--  public API and the two customer write RPCs reject new activity. Existing
--  reviews remain stored, and administrators can still moderate them.
--
--  Run after 20261061000000_coupons_reviews.sql. Idempotent where practical.
-- =============================================================================

alter table public.site_settings
  add column if not exists reviews_enabled boolean not null default true;

comment on column public.site_settings.reviews_enabled is
  'Store-wide Ratings & Reviews feature switch from Nemesis → E-commerce → General';

-- The app can store this flag in the theme_gradients JSON fallback before this
-- column exists; preserve that choice when the real column is added.
update public.site_settings
   set reviews_enabled = (theme_gradients ->> 'reviews_enabled')::boolean
 where id = 1
   and theme_gradients ? 'reviews_enabled'
   and theme_gradients ->> 'reviews_enabled' in ('true', 'false');

-- Fresh-client setup exports may copy this non-secret store preference.
do $$
begin
  if to_regclass('public.client_setup_fields') is not null then
    insert into public.client_setup_fields (table_name, column_name)
    values ('site_settings', 'reviews_enabled')
    on conflict (table_name, column_name) do nothing;
  end if;
end $$;

create or replace function public.reviews_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.reviews_enabled from public.site_settings s where s.id = 1),
    true
  )
$$;

revoke all on function public.reviews_enabled() from public;
grant execute on function public.reviews_enabled() to anon, authenticated;

-- Public/own review reads follow the switch; administrators keep full access
-- through both this policy and the existing moderation policy.
drop policy if exists "Approved reviews are viewable by everyone" on public.product_reviews;
create policy "Approved reviews are viewable by everyone"
  on public.product_reviews for select
  using (
    public.is_admin()
    or (
      public.reviews_enabled()
      and (status = 'approved' or user_id = auth.uid())
    )
  );

-- Stars on cards / product pages disappear while the feature is off.
create or replace view public.product_rating_stats as
  select product_id,
         count(*)::integer as review_count,
         round(avg(rating)::numeric, 2) as avg_rating
    from public.product_reviews
   where status = 'approved'
     and public.reviews_enabled()
   group by product_id;

grant select on public.product_rating_stats to anon, authenticated;

create or replace function public.submit_product_review(p_product_id uuid, p_rating integer, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := nullif(left(trim(coalesce(p_title, '')), 120), '');
  v_body text := left(trim(coalesce(p_body, '')), 2000);
  v_name text;
  v_avatar text;
  v_verified boolean := false;
  v_review public.product_reviews%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to write a review.';
  end if;
  if not public.reviews_enabled() then
    raise exception 'Product reviews are currently disabled.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a star rating.';
  end if;
  if length(v_body) < 3 then
    raise exception 'Please write a little more about the product.';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and is_active) then
    raise exception 'That product is no longer available.';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Customer'), avatar_url
    into v_name, v_avatar
    from public.profiles where id = v_user_id;

  v_verified := exists (
    select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
     where o.user_id = v_user_id and o.status = 'completed' and oi.product_id = p_product_id
  );

  insert into public.product_reviews (
    product_id, user_id, author_name, author_avatar_url, rating, title, body,
    status, is_verified_purchase
  ) values (
    p_product_id, v_user_id, coalesce(v_name, 'Customer'), v_avatar, p_rating, v_title, v_body,
    case when v_verified then 'approved' else 'pending' end, v_verified
  )
  on conflict (product_id, user_id) where user_id is not null
  do update set rating = excluded.rating,
                title = excluded.title,
                body = excluded.body,
                author_name = excluded.author_name,
                author_avatar_url = excluded.author_avatar_url,
                status = excluded.status,
                is_verified_purchase = excluded.is_verified_purchase
  returning * into v_review;

  return to_jsonb(v_review);
end $$;

revoke all on function public.submit_product_review(uuid, integer, text, text) from public;
grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;

create or replace function public.toggle_review_helpful(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.product_reviews%rowtype;
  v_helpful boolean;
begin
  if v_user_id is null then
    raise exception 'Please sign in to vote.';
  end if;
  if not public.reviews_enabled() then
    raise exception 'Product reviews are currently disabled.';
  end if;
  select * into v_review from public.product_reviews where id = p_review_id and status = 'approved';
  if not found then
    raise exception 'That review is no longer available.';
  end if;
  if v_review.user_id = v_user_id then
    raise exception 'You cannot vote on your own review.';
  end if;

  if exists (select 1 from public.review_helpful_votes where review_id = p_review_id and user_id = v_user_id) then
    delete from public.review_helpful_votes where review_id = p_review_id and user_id = v_user_id;
    v_helpful := false;
  else
    insert into public.review_helpful_votes (review_id, user_id) values (p_review_id, v_user_id);
    v_helpful := true;
  end if;

  select helpful_count into v_review.helpful_count from public.product_reviews where id = p_review_id;
  return jsonb_build_object('helpful', v_helpful, 'helpful_count', coalesce(v_review.helpful_count, 0));
end $$;

revoke all on function public.toggle_review_helpful(uuid) from public;
grant execute on function public.toggle_review_helpful(uuid) to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
--  API role grants
--  Supabase grants these to its API roles automatically for objects created in
--  the public schema; repeated here so this file does not depend on that.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;


-- =============================================================================
--  OPTIONAL — demo catalog (4 categories, 12 products, header menu).
--  Delete everything from this line to the end of the file for an empty store.
-- =============================================================================

-- =============================================================================
--  Woo Solution — Tech Catalog Seed (4 Categories, 20 Products with Popular Brands & Features)
--  Run AFTER migrations (including 20261039000000_product_brand.sql).
--
--  Prices are base amounts in micro-dollars (1 USD = 1,000,000::bigint).
-- =============================================================================

-- Ensure the `brand`, `features`, and homepage category showcase columns exist
alter table public.products
  add column if not exists brand text,
  add column if not exists features text;

alter table public.site_settings
  add column if not exists home_show_category_sections boolean not null default true,
  add column if not exists home_category_default_layout text not null default 'grid',
  add column if not exists home_category_banner_style text not null default 'soft',
  add column if not exists home_category_sections jsonb not null default '[]'::jsonb;

-- Remove legacy non-tech demo products & categories if present
delete from public.products
where slug in (
  'classic-cotton-tee',
  'everyday-hoodie',
  'slim-chino-pants',
  'leather-card-wallet',
  'canvas-tote-bag',
  'minimal-steel-watch',
  'ceramic-pour-over-set',
  'linen-throw-blanket',
  'soy-wax-candle',
  'wireless-earbuds',
  'mechanical-keyboard',
  'usb-c-charging-hub'
);

delete from public.menu_items
where kind = 'category'
  and category_id in (
    select id from public.categories where slug in ('apparel', 'accessories', 'home')
  );

delete from public.categories
where slug in ('apparel', 'accessories', 'home');

insert into public.categories (name, slug, icon, sort_order) values
  ('Electronics',          'electronics',        'headphones', 1),
  ('Laptops',              'laptops',            'laptop',     2),
  ('Mobiles',              'mobiles',            'smartphone', 3),
  ('Gaming & Accessories', 'gaming-accessories', 'gamepad-2',  4)
on conflict (slug) do update set
  name       = excluded.name,
  icon       = excluded.icon,
  sort_order = excluded.sort_order;

-- Demo header menu: add the seeded categories after "Shop"
insert into public.menu_items (location, kind, title, category_id, sort_order)
select 'header', 'category', c.name, c.id,
       (select coalesce(max(sort_order), -1) from public.menu_items where location = 'header') + c.sort_order
from public.categories c
where c.slug in ('electronics', 'laptops', 'mobiles', 'gaming-accessories')
  and not exists (select 1 from public.menu_items m where m.location = 'header' and m.category_id = c.id);

insert into public.products
  (category_id, name, slug, brand, description, features, price_micros, compare_at_price_micros, image_url, stock, is_featured, created_at)
values
  -- ── SECTION 01: Electronics (6 products) ──────────────────────────────────
  ((select id from public.categories where slug = 'electronics'),
   'Wireless Noise-Canceling Headphones', 'wireless-noise-canceling-headphones', 'SONY',
   'Industry-leading noise cancellation headphone with adaptive sound control and extreme acoustic depth.',
   'Custom Active Noise Cancellation, 30 Hours Battery, Speak-to-Chat Ambient Sensor',
   349 * 1000000::bigint, 399 * 1000000::bigint,
   'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
   45, true, now() - interval '1 minute'),

  ((select id from public.categories where slug = 'electronics'),
   'Smart Watch Pro Edition', 'smart-watch-pro-edition', 'APPLE',
   'Advanced health metrics, fitness tracking, and seamless connectivity on a durable titanium body.',
   'Always-On OLED Display, ECG & Blood Oxygen Sensor, Dual-Frequency GPS',
   429 * 1000000::bigint, 499 * 1000000::bigint,
   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80',
   30, true, now() - interval '2 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'Portable Bluetooth Boom Speaker', 'portable-bluetooth-boom-speaker', 'JBL',
   'Bold sound and punchy bass for indoor listening or outdoor rugged adventures.',
   'IP67 Waterproof & Dustproof, 24 Hours Playtime, PartyBoost Stereo Pairing',
   149 * 1000000::bigint, 179 * 1000000::bigint,
   'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=80',
   60, false, now() - interval '3 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'QuietComfort Ultra Wireless Earbuds', 'quietcomfort-ultra-wireless-earbuds', 'BOSE',
   'Spatial audio earbuds with world-class noise cancellation and custom-tuned acoustic architecture.',
   'CustomTune Spatial Audio, World-Class ANC, Snapdragon Sound AptX',
   249 * 1000000::bigint, 299 * 1000000::bigint,
   'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=900&q=80',
   50, false, now() - interval '4 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'Alpha Mirrorless 4K Vlog Camera', 'alpha-mirrorless-4k-vlog-camera', 'SONY',
   'Compact APS-C mirrorless camera with real-time eye autofocus, 4K 60p video, and directional 3-capsule mic.',
   '24.2MP APS-C Exmor Sensor, Real-Time Eye AF, 4K HDR 60p Recording',
   799 * 1000000::bigint, 899 * 1000000::bigint,
   'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80',
   18, false, now() - interval '5 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'iPad Air M2 11-Inch Wi-Fi', 'ipad-air-m2-11-inch', 'APPLE',
   'Liquid Retina display powered by the Apple M2 chip with Apple Pencil Pro support and all-day battery.',
   'Apple M2 8-Core Chip, 11" Liquid Retina Display, Wi-Fi 6E & Touch ID',
   549 * 1000000::bigint, 599 * 1000000::bigint,
   'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=900&q=80',
   25, false, now() - interval '6 minutes'),

  -- ── SECTION 02: Laptops (6 products) ──────────────────────────────────────
  ((select id from public.categories where slug = 'laptops'),
   'UltraSlim Pro 14 Laptop', 'ultraslim-pro-14-laptop', 'APPLE',
   'Ultra-thin sleek design engineered for power efficiency, vivid graphics, and all-day battery.',
   'Liquid Retina XDR 120Hz, 18-Hour Battery Life, MagSafe 3 & Thunderbolt 4',
   1299 * 1000000::bigint, 1449 * 1000000::bigint,
   'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
   20, true, now() - interval '7 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Gaming Beast RTX 4070 Laptop', 'gaming-beast-rtx-4070-laptop', 'ASUS',
   'Uncompromised frame rates and liquid cooling tech designed for competitive AAA gaming.',
   'NVIDIA GeForce RTX 4070, 240Hz ROG Nebula Display, Tri-Fan Liquid Metal Cooling',
   1799 * 1000000::bigint, 1999 * 1000000::bigint,
   'https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=900&q=80',
   15, true, now() - interval '8 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Creator Studio Book 16', 'creator-studio-book-16', 'DELL',
   'Tailor-made for video editors, 3D artists, and photographers requiring 100% color accuracy.',
   '4K+ InfinityEdge Touch OLED, 100% DCI-P3 Color Gamut, 32GB LPDDR5x RAM',
   1999 * 1000000::bigint, 2199 * 1000000::bigint,
   'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
   12, false, now() - interval '9 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'ThinkPad X1 Carbon Gen 12', 'thinkpad-x1-carbon-gen-12', 'LENOVO',
   'Featherlight carbon-fiber business ultrabook with Intel Core Ultra processor and legendary keyboard.',
   'Intel Core Ultra 7 vPro, 1.09 kg Carbon Chassis, MIL-STD-810H Tested',
   1599 * 1000000::bigint, 1799 * 1000000::bigint,
   'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?auto=format&fit=crop&w=900&q=80',
   22, false, now() - interval '10 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Spectre x360 14 2-in-1 OLED', 'spectre-x360-14-oled', 'HP',
   'Convertible 2.8K OLED touchscreen laptop with 360-degree hinge, stylus support, and quad speakers.',
   '2.8K 120Hz IMAX OLED Touch, 360° Convertible Hinge, Poly Studio Quad Audio',
   1399 * 1000000::bigint, 1549 * 1000000::bigint,
   'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=900&q=80',
   16, false, now() - interval '11 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Blade 16 Dual-Mode Mini-LED', 'blade-16-dual-mode-mini-led', 'RAZER',
   'CNC-milled aluminum gaming laptop featuring a dual-mode UHD+ 120Hz / FHD+ 240Hz Mini-LED display.',
   'Dual-Mode Mini-LED Display, CNC Anodized Aluminum, Vapor Chamber Cooling',
   2499 * 1000000::bigint, 2799 * 1000000::bigint,
   'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=900&q=80',
   9, false, now() - interval '12 minutes'),

  -- ── SECTION 03: Mobiles (4 products) ──────────────────────────────────────
  ((select id from public.categories where slug = 'mobiles'),
   'Galaxy S25 Ultra 5G 512GB', 'galaxy-s25-ultra-5g', 'SAMSUNG',
   '200MP pro-grade quad camera system, built-in S Pen, and anti-reflective Gorilla Armor titanium frame.',
   '200MP Quad Telephoto Camera, Built-In S Pen Stylus, Snapdragon 8 Elite',
   1199 * 1000000::bigint, 1349 * 1000000::bigint,
   'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=80',
   35, true, now() - interval '13 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'iPhone 16 Pro Max 256GB', 'iphone-16-pro-max-256gb', 'APPLE',
   'Grade 5 titanium design with 120Hz ProMotion display, A18 Pro chip, and 4K 120fps Dolby Vision.',
   'A18 Pro 3nm Silicon, 5x Tetraprism Telephoto, Camera Control Button',
   1099 * 1000000::bigint, 1199 * 1000000::bigint,
   'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=900&q=80',
   40, true, now() - interval '14 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'Pixel 9 Pro XL 5G', 'pixel-9-pro-xl-5g', 'GOOGLE',
   'Super Actua LTPO display powered by Google Tensor G4 with pro triple rear camera and Gemini AI.',
   'Google Tensor G4 + Gemini, 6.8" Super Actua Display, 7 Years OS Updates',
   949 * 1000000::bigint, 1099 * 1000000::bigint,
   'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=80',
   28, false, now() - interval '15 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'OnePlus 13 5G Snapdragon Elite', 'oneplus-13-5g-snapdragon-elite', 'ONEPLUS',
   'Hasselblad camera for mobile, 100W SuperVOOC ultra-fast charging, and 2K 120Hz ProXDR display.',
   'Hasselblad Triple 50MP Camera, 100W SuperVOOC Flash Charge, 6000mAh Silicon Battery',
   849 * 1000000::bigint, 949 * 1000000::bigint,
   'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
   32, false, now() - interval '16 minutes'),

  -- ── SECTION 04: Gaming & Accessories (4 products) ─────────────────────────
  ((select id from public.categories where slug = 'gaming-accessories'),
   'G Pro X Superlight 2 Wireless Mouse', 'g-pro-x-superlight-2-mouse', 'LOGITECH',
   '60g ultra-lightweight esports mouse with HERO 2 32K sensor and LIGHTFORCE hybrid optical switches.',
   '60g Ultra-Lightweight Design, HERO 2 32,000 DPI Sensor, 4000Hz Wireless Polling',
   139 * 1000000::bigint, 159 * 1000000::bigint,
   'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80',
   55, false, now() - interval '17 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'BlackWidow V4 Pro Mechanical Keyboard', 'blackwidow-v4-pro-keyboard', 'RAZER',
   'Full-blown battlestation mechanical keyboard with command dial, dedicated macro keys, and Chroma RGB.',
   'Razer Command Dial & 8 Macro Keys, Per-Key Chroma RGB Underglow, Magnetic Plush Wrist Rest',
   199 * 1000000::bigint, 229 * 1000000::bigint,
   'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
   26, false, now() - interval '18 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'UltraGear 27" 4K OLED 240Hz Monitor', 'ultragear-27-4k-oled-monitor', 'LG',
   '0.03ms response time OLED gaming monitor with DisplayHDR True Black 400 and NVIDIA G-SYNC.',
   '27" 4K OLED 240Hz Panel, 0.03ms GtG Response Time, NVIDIA G-SYNC & FreeSync Pro',
   899 * 1000000::bigint, 1049 * 1000000::bigint,
   'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=80',
   14, false, now() - interval '19 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'Prime 250W GaN Desktop Charging Station', 'prime-250w-gan-charging-station', 'ANKER',
   '6-port ultra-fast GaNPrime power station with smart LCD power dial and four USB-C PD 3.1 ports.',
   '250W Total GaNPrime Output, 4x USB-C + 2x USB-A Ports, Smart Real-Time Power Display',
   129 * 1000000::bigint, 159 * 1000000::bigint,
   'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=900&q=80',
   48, false, now() - interval '20 minutes')
on conflict (slug) do update set
  category_id             = excluded.category_id,
  name                    = excluded.name,
  brand                   = excluded.brand,
  description             = excluded.description,
  features                = excluded.features,
  price_micros            = excluded.price_micros,
  compare_at_price_micros = excluded.compare_at_price_micros,
  image_url               = excluded.image_url,
  stock                   = excluded.stock,
  is_featured             = excluded.is_featured,
  created_at              = excluded.created_at;

-- ── Demo coupons (migration 20261061000000) ─────────────────────────────────
-- Safe to re-run: an existing code (any case) is left untouched.
insert into public.coupons (
  code, description, discount_type, percent_off, amount_off_micros,
  min_subtotal_micros, free_shipping, first_order_only, usage_limit, per_user_limit
) values
  ('WELCOME10', '10% off your first order – welcome aboard!', 'percent', 10, null, 0, false, true, null, 1),
  ('FREESHIP',  'Free shipping on orders over $75',            'percent', null, null, 75 * 1000000, true, false, null, 5),
  ('SAVE20',    '$20 off orders over $100',                    'fixed',   null, 20 * 1000000, 100 * 1000000, false, false, 100, 1)
on conflict ((upper(code))) do nothing;

-- ── Demo reviews (migration 20261061000000) ─────────────────────────────────
-- Snapshot authors (no demo auth users exist at seed time). Guarded by
-- author name + product so re-running the seed never duplicates them.
insert into public.product_reviews (
  product_id, user_id, author_name, rating, title, body, status,
  is_verified_purchase, helpful_count, response_text, response_at, created_at
)
select p.id, null, d.author, d.rating, d.title, d.body, 'approved', true, d.helpful, d.response,
       case when d.response is null then null else now() - interval '2 days' end,
       now() - (d.days_ago * interval '1 day')
  from public.products p
  join (values
    ('wireless-noise-canceling-headphones', 'Amelia R.', 5, 'Worth every penny',
     'The noise cancelling on a long-haul flight was unreal – engine hum just disappeared. Battery easily lasted the whole trip and the case feels premium.', 14, null, 3),
    ('wireless-noise-canceling-headphones', 'Daniel K.', 5, 'Best headphones I have owned',
     'Upgraded from an older pair and the difference is night and day. Calls are crystal clear even on a windy street.', 9,
     'Thank you, Daniel! Tip: the companion EQ preset "Excited" makes calls even clearer outdoors.', 6),
    ('wireless-noise-canceling-headphones', 'Priya S.', 4, 'Great sound, snug fit',
     'Sound quality and ANC are excellent. They felt a little tight during the first week but have loosened up nicely since.', 3, null, 11),
    ('smart-watch-pro-edition', 'Marcus T.', 5, 'Replaced my fitness tracker and my watch',
     'GPS accuracy on runs matches my chest-strap setup, and sleep tracking has genuinely changed my routine. Titanium body still looks brand new.', 11, null, 4),
    ('smart-watch-pro-edition', 'Lena W.', 4, 'Excellent, app could be simpler',
     'The hardware is flawless and the display is gorgeous outdoors. The companion app buries a few settings, but updates keep improving it.', 4, null, 9),
    ('quietcomfort-ultra-wireless-earbuds', 'Omar H.', 5, 'Tiny, mighty, silent',
     'I work next to a construction site and these turn it into a library. Spatial audio for movies is a lovely bonus.', 7, null, 2),
    ('quietcomfort-ultra-wireless-earbuds', 'Sofia M.', 3, 'Good buds, case is bulky',
     'Comfort and ANC are top tier, but the charging case is bigger than rivals and noticeably fills a jeans pocket.', 1,
     'Thanks for the honest feedback, Sofia – we have passed the case-size note to our buying team for the next range review.', 7),
    ('ultraslim-pro-14-laptop', 'James L.', 5, 'My whole office in 1.2 kg',
     'Compiles our monorepo faster than my desktop did, stays quiet, and I stopped carrying the charger for day trips.', 18, null, 5)
  ) as d(slug, author, rating, title, body, helpful, response, days_ago)
    on d.slug = p.slug
 where not exists (
   select 1 from public.product_reviews r
    where r.product_id = p.id and r.author_name = d.author
 );
