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
