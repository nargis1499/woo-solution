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
   where s.seo_og_image_media_id = any (p_ids);
$$;

grant execute on function public.media_usage(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
--  9. Backfill: rows that already had a catalogue of options stay simple
-- -----------------------------------------------------------------------------
update public.products set type = 'simple' where type is null;
