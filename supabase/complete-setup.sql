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
--   • All 38 migrations in order — schema, RLS, triggers, functions, storage bucket.
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
