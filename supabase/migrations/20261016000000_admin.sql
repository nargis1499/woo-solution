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
