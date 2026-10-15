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
