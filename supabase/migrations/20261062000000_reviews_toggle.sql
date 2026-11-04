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
