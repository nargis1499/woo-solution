-- Read-only Customer Intelligence. No new customer shadow table or mutation RPC.
create index if not exists orders_customer_history_idx on public.orders(user_id,created_at desc,id desc);
create index if not exists orders_guest_customer_key_idx on public.orders((md5(lower(btrim(customer_email))))) where user_id is null and nullif(btrim(customer_email),'') is not null;

create function public.nemesis_customers_read(p jsonb default '{}', p_mode text default 'analytics') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp
set statement_timeout='15s' as $$
#variable_conflict use_column
declare
 result jsonb;
 as_of timestamptz := coalesce((p->>'to')::timestamptz,statement_timestamp());
 since timestamptz := coalesce((p->>'from')::timestamptz,case when p_mode in ('new','analytics') then as_of-interval '30 days' else '1970-01-01'::timestamptz end);
 days integer := coalesce((p->>'inactiveDays')::integer,90);
 min_purchases integer := coalesce((p->>'minPurchases')::integer,case when p_mode='repeat' then 2 else 0 end);
 page_size integer := coalesce((p->>'limit')::integer,10);
 page_no integer := coalesce((p->>'page')::integer,1);
 exact_key text := p->>'customerKey';
 q text := nullif(btrim(p->>'search'),'');
 sort_by text := coalesce(p->>'sort',case when p_mode='new' then 'newest' when p_mode='inactive' then 'oldest' else 'spending' end);
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_mode not in ('details','history','search','top','inactive','repeat','new','analytics') then raise exception 'Invalid customer report'; end if;
 if page_size not between 1 and 50 or page_no not between 1 and 10000 or days not between 1 and 3650 or min_purchases not between 0 and 100000 then raise exception 'Invalid customer pagination or thresholds'; end if;
 if since>=as_of or as_of>statement_timestamp()+interval '1 minute' then raise exception 'Invalid customer date range'; end if;
 if p_mode='repeat' then min_purchases:=greatest(2,min_purchases); end if;
 if sort_by not in ('spending','purchases','newest','oldest','name') then raise exception 'Invalid customer sort'; end if;
 if length(coalesce(q,''))>120 then raise exception 'Search is too long'; end if;
 if exact_key is not null and exact_key !~ '^((u|o):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{32})$' then raise exception 'Invalid customer key'; end if;
 if p_mode in ('details','history') and exact_key is null then raise exception 'Select an exact customer, not a name'; end if;

 with orders_as_of as materialized (
   select o.id,o.user_id,o.customer_email,o.shipping_name,o.created_at,o.order_number,o.status,o.payment_status,o.total_micros,
     case when o.user_id is not null then 'u:'||o.user_id::text
       when nullif(btrim(o.customer_email),'') is not null then 'e:'||md5(lower(btrim(o.customer_email))) else 'o:'||o.id::text end as customer_key,
     (o.status='completed' and o.payment_status='paid') as eligible
   from public.orders o where o.created_at<as_of and (
     exact_key is null
     or (left(exact_key,2)='u:' and o.user_id=case when left(exact_key,2)='u:' then substring(exact_key from 3)::uuid end)
     or (left(exact_key,2)='e:' and o.user_id is null and nullif(btrim(o.customer_email),'') is not null and md5(lower(btrim(o.customer_email)))=substring(exact_key from 3))
     or (left(exact_key,2)='o:' and o.id=case when left(exact_key,2)='o:' then substring(exact_key from 3)::uuid end and o.user_id is null and nullif(btrim(o.customer_email),'') is null)
   )
 ), aggregate_orders as (
   select customer_key,min(id::text)::uuid as anchor_id,count(*) as order_count,
     count(*) filter(where eligible) as purchases,
     coalesce(sum(total_micros) filter(where eligible),0) as spending,
     min(created_at) filter(where eligible) as first_purchase,max(created_at) filter(where eligible) as last_purchase,
     count(*) filter(where eligible and created_at>=since) as window_purchases,
     coalesce(sum(total_micros) filter(where eligible and created_at>=since),0) as window_spending,
     count(*) filter(where status='cancelled') as cancellations,
     count(*) filter(where payment_status='refunded') as refunds
   from orders_as_of group by customer_key
 ), identities as (
   select 'u:'||pr.id::text as customer_key from public.profiles pr where not pr.is_admin and pr.created_at<as_of and (exact_key is null or 'u:'||pr.id::text=exact_key)
   union select customer_key from aggregate_orders
 ), customers as materialized (
   select i.customer_key as key,
     case when i.customer_key like 'u:%' then 'registered' when i.customer_key like 'e:%' then 'guest_email_group' else 'unidentified_order' end as identity,
     coalesce(nullif(pr.full_name,''),nullif(o.shipping_name,''),'Unnamed customer') as name,
     coalesce(pr.email,o.customer_email) as email,
     pr.created_at as registered_at,a.anchor_id,
     coalesce(a.order_count,0) as orders,coalesce(a.purchases,0) as purchases,coalesce(a.spending,0) as spending,
     coalesce(a.window_purchases,0) as window_purchases,coalesce(a.window_spending,0) as window_spending,
     a.first_purchase,a.last_purchase,coalesce(a.cancellations,0) as cancellations,coalesce(a.refunds,0) as refunds
   from identities i left join aggregate_orders a on a.customer_key=i.customer_key
   left join public.profiles pr on i.customer_key='u:'||pr.id::text
   left join public.orders o on o.id=a.anchor_id
 ), matched as materialized (
   select c.* from customers c where (exact_key is null or c.key=exact_key)
     and (q is null or position(lower(q) in lower(c.name))>0 or position(lower(q) in lower(coalesce(c.email,'')))>0)
     and c.window_purchases>=min_purchases
     and (p_mode<>'top' or c.window_purchases>0)
     and (p_mode<>'inactive' or (c.purchases>0 and c.last_purchase<as_of-make_interval(days=>days)))
     and (p_mode<>'new' or (c.first_purchase>=since and c.first_purchase<as_of))
 ), ranked as (
   select c.*,row_number() over(order by
     case when sort_by='spending' then window_spending end desc,
     case when sort_by='purchases' then window_purchases end desc,
     case when sort_by='newest' then first_purchase end desc nulls last,
     case when sort_by='oldest' then last_purchase end asc nulls last,
     case when sort_by='name' then lower(name) end asc,key) as rn
   from matched c
 ), metrics as (
   select count(*) as customers,count(*) filter(where window_purchases>0) as buyers,
     count(*) filter(where window_purchases>=2) as repeat_buyers,
     count(*) filter(where first_purchase>=since and first_purchase<as_of) as new_buyers,
     count(*) filter(where first_purchase<since and window_purchases>0) as returning_buyers,
     count(*) filter(where purchases>0 and last_purchase<as_of-make_interval(days=>days)) as inactive_buyers,
     count(*) filter(where purchases=0) as not_converted,
     coalesce(sum(window_purchases),0) as purchases,coalesce(sum(window_spending),0) as spending
   from matched
 ), history as (
   select id,order_number,created_at,status,payment_status,total_micros,eligible
   from orders_as_of where customer_key=exact_key and created_at>=since
   order by created_at desc,id desc limit page_size offset (page_no-1)*page_size
 )
 select jsonb_build_object(
   'generatedAt',statement_timestamp(),'mode',p_mode,'baseCurrency','USD',
   'filters',jsonb_build_object('from',since,'to',as_of,'inactiveDays',days,'minPurchases',min_purchases,'limit',page_size,'page',page_no,'sort',sort_by,'search',coalesce(q,''),'customerKey',exact_key),
   'total',case when p_mode='history' then (select count(*) from orders_as_of where customer_key=exact_key and created_at>=since) else (select count(*) from matched) end,
   'metrics',(select to_jsonb(m)||jsonb_build_object('aov',case when m.purchases=0 then null else round(m.spending/m.purchases) end) from metrics m),
   'rows',coalesce((select jsonb_agg(to_jsonb(r)-'rn'-'email' order by r.rn) from ranked r where (p_mode='history' and rn=1) or (p_mode<>'history' and rn between (page_no-1)*page_size+1 and page_no*page_size)),'[]'::jsonb),
   'history',case when p_mode='history' then coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from history h),'[]'::jsonb) else '[]'::jsonb end,
   'detail',case when p_mode='details' then (
     select jsonb_build_object('email',c.email,'phone',coalesce(pr.phone,o.shipping_phone),
       'address',case when o.id is null then null else concat_ws(', ',o.shipping_address_line1,o.shipping_address_line2,o.shipping_city,o.shipping_postal_code,o.shipping_country) end,
       'contactSource','Registered profile when available; otherwise a recorded order. Shipping address is from a representative recorded order, not a verified current address.')
     from matched c left join public.profiles pr on c.key='u:'||pr.id::text
     left join public.orders o on o.id=c.anchor_id limit 1
   ) else null end
 ) into result;
 if abs((result->'metrics'->>'spending')::numeric)>9007199254740991 or exists(select 1 from jsonb_array_elements(result->'rows') r where abs((r->>'spending')::numeric)>9007199254740991 or abs((r->>'window_spending')::numeric)>9007199254740991) or exists(select 1 from jsonb_array_elements(result->'history') h where abs((h->>'total_micros')::numeric)>9007199254740991) then raise exception 'Customer amounts exceed supported exact integer range'; end if;
 return result;
end;
$$;
revoke all on function public.nemesis_customers_read(jsonb,text) from public,anon,authenticated;
grant execute on function public.nemesis_customers_read(jsonb,text) to authenticated;
notify pgrst, 'reload schema';
