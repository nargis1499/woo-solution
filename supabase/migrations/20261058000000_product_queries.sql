-- Reusable, bounded, read-only catalog queries. No model-generated SQL or writes.
-- Internal fixed-operator evaluator; not exposed through the API.
create function public.nemesis_product_number_matches(n numeric, rule jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
declare op text; value jsonb; threshold numeric; matches boolean := true;
begin
 if rule is null or rule='null'::jsonb then return true; end if;
 if jsonb_typeof(rule)<>'object' then raise exception 'Numeric filter must be an object'; end if;
 for op,value in select * from jsonb_each(rule) loop
   if op not in ('gt','gte','lt','lte','eq','ne') then raise exception 'Unsupported comparison %',op; end if;
   if value='null'::jsonb then continue; end if;
   if jsonb_typeof(value)<>'number' then raise exception 'Comparison requires a number'; end if;
   threshold:=value::numeric;
   if abs(threshold)>9007199254740991 then raise exception 'Comparison is outside supported precision'; end if;
   matches:=matches and coalesce(case op when 'gt' then n>threshold when 'gte' then n>=threshold
     when 'lt' then n<threshold when 'lte' then n<=threshold when 'eq' then n=threshold when 'ne' then n<>threshold end,false);
 end loop;
 return matches;
end $$;
revoke all on function public.nemesis_product_number_matches(numeric,jsonb) from public,anon,authenticated;

create function public.nemesis_products_read(p jsonb default '{}') returns jsonb
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
 -- Unknown categories must never drop a filter and broaden a read.
 if p->>'category' is not null then
   select count(*) into category_count from public.categories c where lower(c.name)=lower(p->>'category') or lower(c.slug)=lower(p->>'category');
   if category_count<>1 then raise exception 'Category missing or ambiguous; use an exact slug or ID'; end if;
 end if;
 if p->>'categorySlug' is not null and not exists(select 1 from public.categories c where c.slug=p->>'categorySlug') then raise exception 'Unknown category slug'; end if;
 if p->>'categoryId' is not null and not exists(select 1 from public.categories c where c.id=(p->>'categoryId')::uuid) then raise exception 'Unknown category ID'; end if;
 if p->'categorySlugs' is not null and p->'categorySlugs'<>'null'::jsonb and exists(
   select 1 from jsonb_array_elements_text(coalesce(nullif(p->'categorySlugs','null'::jsonb),'[]'::jsonb)) s(slug) where not exists(select 1 from public.categories c where c.slug=s.slug)
 ) then raise exception 'Unknown category in categorySlugs'; end if;
 select coalesce(p->>'currency',case when s.currency='BDT' and s.usd_to_bdt_rate>0 then 'BDT' else 'USD' end),s.usd_to_bdt_rate
   into currency_code,fx from public.site_settings s where s.id=1;
 currency_code:=coalesce(currency_code,p->>'currency','USD');
 if currency_code not in ('USD','BDT') then raise exception 'Unsupported currency'; end if;
 if currency_code='USD' then fx:=1; elsif fx is null or fx<=0 then raise exception 'Configure USD to BDT rate before querying BDT prices'; end if;

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
   -- Compare what the administrator sees (rounded cents/poisha), not raw FX micros.
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
comment on function public.nemesis_products_read(jsonb) is 'Admin-only read-only full-catalog filters, exact cohort metrics and bounded product/variation pages. No cost/private financial fields.';
