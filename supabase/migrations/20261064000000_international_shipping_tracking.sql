-- =============================================================================
--  Migration 54 – International Multi-Currency, Free-Shipping Threshold &
--                 Order Tracking Notifications
--
--  1. Expands `public.site_settings.currency` to 14 international currencies
--     (USD, EUR, GBP, CAD, AUD, SGD, CHF, AED, SAR, INR, BDT, MYR, BRL, MXN).
--  2. Adds `free_shipping_threshold_micros` to `public.site_settings` and
--     updates `public.calculate_shipping(bigint)` so orders meeting the
--     post-discount threshold receive free shipping automatically.
--  3. Updates `public.place_order(jsonb, jsonb, text)` and
--     `public.nemesis_products_read(jsonb)` to support all 14 currencies.
--  4. Ensures shipment/tracking columns exist on `public.orders` and extends
--     `public.orders_notify_status()` so customers receive real-time in-app
--     notifications when an order is shipped/delivered or a tracking number
--     is added.
-- =============================================================================

-- 1. International store currencies + free-shipping threshold on site_settings
alter table public.site_settings
  add column if not exists free_shipping_threshold_micros bigint;

alter table public.site_settings drop constraint if exists site_settings_currency_check;
alter table public.site_settings
  add constraint site_settings_currency_check
  check (
    currency in (
      'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF',
      'AED', 'SAR', 'INR', 'BDT', 'MYR', 'BRL', 'MXN'
    )
  );

alter table public.site_settings drop constraint if exists site_settings_free_shipping_threshold_micros_check;
alter table public.site_settings
  add constraint site_settings_free_shipping_threshold_micros_check
  check (free_shipping_threshold_micros is null or free_shipping_threshold_micros >= 0);

comment on column public.site_settings.currency is
  'Store display currency (prices stay in USD micro-dollars in the database)';
comment on column public.site_settings.usd_to_bdt_rate is
  '1 USD = this many units of site_settings.currency; used whenever currency <> USD';
comment on column public.site_settings.free_shipping_threshold_micros is
  'Post-discount order subtotal in USD micro-dollars at or above which shipping is free (null = no automatic threshold)';

do $$
begin
  if to_regclass('public.client_setup_fields') is not null then
    insert into public.client_setup_fields(table_name, column_name)
    values ('site_settings', 'free_shipping_threshold_micros')
    on conflict do nothing;
  end if;
end $$;

-- 2. Ensure shipment & tracking columns exist on orders (idempotent)
alter table public.orders
  add column if not exists fulfillment_status text not null default 'unfulfilled',
  add column if not exists shipping_status text not null default 'pending',
  add column if not exists shipping_carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz;

-- 3. calculate_shipping: honours both shipping_enabled and free_shipping_threshold_micros
create or replace function public.calculate_shipping(p_subtotal_micros bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled   boolean := true;
  v_rate      bigint  := 5000000;
  v_threshold bigint  := null;
begin
  if coalesce(p_subtotal_micros, 0) <= 0 then
    return 0;
  end if;

  select coalesce(shipping_enabled, true),
         coalesce(shipping_rate_micros, 5000000),
         free_shipping_threshold_micros
    into v_enabled, v_rate, v_threshold
    from public.site_settings
   where id = 1;

  if not coalesce(v_enabled, true) then
    return 0;
  end if;

  if v_threshold is not null and v_threshold > 0 and p_subtotal_micros >= v_threshold then
    return 0;
  end if;

  return greatest(coalesce(v_rate, 0), 0);
end $$;

comment on function public.calculate_shipping(bigint) is
  'Checkout shipping in USD micro-dollars from site_settings (0 when shipping_enabled is false or subtotal meets free_shipping_threshold_micros)';

-- 4. place_order: stamps any configured international currency + rate
create or replace function public.place_order(p_items jsonb, p_shipping jsonb, p_coupon_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_email        text;
  v_order_id     uuid;
  v_item         jsonb;
  v_product      public.products%rowtype;
  v_variation    public.product_variations%rowtype;
  v_variation_id uuid;
  v_qty          integer;
  v_price        bigint;
  v_stock        integer;
  v_label        text;
  v_subtotal     bigint := 0;
  v_shipping     bigint;
  v_managed      boolean;
  v_currency     text := 'USD';
  v_rate         numeric := 1;
  v_coupon       public.coupons%rowtype;
  v_coupon_code  text := nullif(upper(trim(coalesce(p_coupon_code, ''))), '');
  v_eligible     bigint := 0;
  v_discount     bigint := 0;
  v_used         integer;
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

  select case
           when s.currency in ('EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF', 'AED', 'SAR', 'INR', 'BDT', 'MYR', 'BRL', 'MXN')
                and coalesce(s.usd_to_bdt_rate, 0) > 0
             then s.currency
           else 'USD'
         end,
         case
           when s.currency in ('EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF', 'AED', 'SAR', 'INR', 'BDT', 'MYR', 'BRL', 'MXN')
                and coalesce(s.usd_to_bdt_rate, 0) > 0
             then s.usd_to_bdt_rate
           else 1
         end
    into v_currency, v_rate
    from public.site_settings s
   where s.id = 1;
  if v_currency is null then
    v_currency := 'USD';
    v_rate := 1;
  end if;

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

-- 5. nemesis_products_read: accepts all 14 international currencies
create or replace function public.nemesis_products_read(p jsonb default '{}') returns jsonb
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
 if p->>'category' is not null then
   select count(*) into category_count from public.categories c where lower(c.name)=lower(p->>'category') or lower(c.slug)=lower(p->>'category');
   if category_count<>1 then raise exception 'Category missing or ambiguous; use an exact slug or ID'; end if;
 end if;
 if p->>'categorySlug' is not null and not exists(select 1 from public.categories c where c.slug=p->>'categorySlug') then raise exception 'Unknown category slug'; end if;
 if p->>'categoryId' is not null and not exists(select 1 from public.categories c where c.id=(p->>'categoryId')::uuid) then raise exception 'Unknown category ID'; end if;
 if p->'categorySlugs' is not null and p->'categorySlugs'<>'null'::jsonb and exists(
   select 1 from jsonb_array_elements_text(coalesce(nullif(p->'categorySlugs','null'::jsonb),'[]'::jsonb)) s(slug) where not exists(select 1 from public.categories c where c.slug=s.slug)
 ) then raise exception 'Unknown category in categorySlugs'; end if;
 select coalesce(
          p->>'currency',
          case
            when s.currency in ('EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF', 'AED', 'SAR', 'INR', 'BDT', 'MYR', 'BRL', 'MXN')
                 and s.usd_to_bdt_rate > 0
              then s.currency
            else 'USD'
          end
        ),
        s.usd_to_bdt_rate
   into currency_code,fx from public.site_settings s where s.id=1;
 currency_code:=coalesce(currency_code,p->>'currency','USD');
 if currency_code not in ('USD','EUR','GBP','CAD','AUD','SGD','CHF','AED','SAR','INR','BDT','MYR','BRL','MXN') then
   raise exception 'Unsupported currency';
 end if;
 if currency_code='USD' then fx:=1; elsif fx is null or fx<=0 then raise exception 'Configure exchange rate before querying % prices', currency_code; end if;

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

-- 6. orders_notify_status: also notifies customer on shipment/delivery/tracking updates
create or replace function public.orders_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref     text;
  v_carrier text;
  v_track   text;
begin
  v_ref     := '#' || lpad(new.order_number::text, 4, '0');
  v_carrier := nullif(trim(coalesce(new.shipping_carrier, '')), '');
  v_track   := nullif(trim(coalesce(new.tracking_number, '')), '');

  -- the customer: their order status moved
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

  -- the customer: shipment / delivery / tracking number updates
  if new.user_id is not null then
    if new.fulfillment_status is distinct from old.fulfillment_status
       and new.fulfillment_status in ('shipped', 'delivered') then
      insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
      values (
        new.user_id,
        'order_status',
        'Order ' || v_ref || ' · ' || initcap(new.fulfillment_status),
        case
          when new.fulfillment_status = 'delivered'
            then 'Your package has been marked as delivered.'
          when v_track is not null
            then 'Your order is on the way'
                 || case when v_carrier is not null then ' via ' || v_carrier else '' end
                 || ' · Tracking: ' || v_track || '.'
          else 'Your order has been shipped and is on its way.'
        end,
        '/orders/' || new.id,
        new.id,
        'Admin'
      );
    elsif v_track is not null and new.tracking_number is distinct from old.tracking_number then
      insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
      values (
        new.user_id,
        'order_status',
        'Order ' || v_ref || ' · Tracking updated',
        'Tracking number'
          || case when v_carrier is not null then ' (' || v_carrier || ')' else '' end
          || ': ' || v_track || '.',
        '/orders/' || new.id,
        new.id,
        'Admin'
      );
    end if;
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
  after update of status, payment_status, fulfillment_status, tracking_number on public.orders
  for each row execute function public.orders_notify_status();
