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
