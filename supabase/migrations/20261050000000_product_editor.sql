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
