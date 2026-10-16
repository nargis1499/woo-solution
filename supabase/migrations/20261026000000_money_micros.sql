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
