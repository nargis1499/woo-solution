-- Order Intelligence: private operational history, approved actions, bounded admin RPCs.
-- Amounts remain base USD micros. Unknown historical timestamps are never fabricated.
alter table public.orders
  add column fulfillment_status text not null default 'unknown' check (fulfillment_status in ('unknown','unfulfilled','packed','shipped','delivered')),
  add column shipping_status text not null default 'unknown' check (shipping_status in ('unknown','pending','in_transit','delayed','delivered')),
  add column tracking_number text,
  add column tracking_url text,
  add column shipping_carrier text,
  add column paid_at timestamptz,
  add column fulfilled_at timestamptz,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column fulfillment_due_at timestamptz,
  add column expected_delivery_at timestamptz,
  add column refund_requested_at timestamptz,
  add column refund_request_status text not null default 'none' check (refund_request_status in ('none','requested','completed'));
alter table public.orders alter column fulfillment_status set default 'unfulfilled';
alter table public.orders alter column shipping_status set default 'pending';

create index orders_intelligence_created_idx on public.orders(created_at desc,id desc);
create index orders_intelligence_status_created_idx on public.orders(status,created_at desc);
create index orders_intelligence_payment_created_idx on public.orders(payment_status,created_at desc);
create index orders_intelligence_email_created_idx on public.orders(lower(customer_email),created_at desc);
create index orders_intelligence_fulfillment_idx on public.orders(fulfillment_status,created_at desc);
create index order_items_intelligence_product_idx on public.order_items(product_id,order_id);

create table public.order_operations_log (
 id uuid primary key default gen_random_uuid(),
 order_id uuid references public.orders(id) on delete set null,
 order_number bigint,
 actor_id uuid references auth.users(id) on delete set null,
 event text not null,
 message text not null,
 success boolean not null default true,
 created_at timestamptz not null default now()
);
create index order_operations_log_order_idx on public.order_operations_log(order_id,created_at desc);
alter table public.order_operations_log enable row level security;
create policy "Admin reads order operations" on public.order_operations_log for select to authenticated using(public.is_admin());
revoke all on public.order_operations_log from anon, authenticated;
grant select on public.order_operations_log to authenticated;

create table public.order_action_previews (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 order_version timestamptz not null,
 action text not null,
 payload jsonb not null,
 expires_at timestamptz not null default now() + interval '30 minutes',
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index order_action_previews_actor_expiry_idx on public.order_action_previews(actor_id,expires_at);
alter table public.order_action_previews enable row level security;
revoke all on public.order_action_previews from anon, authenticated;
-- Only guarded RPCs access previews. Client-supplied plan contents are never authoritative.

create or replace function public.capture_order_intelligence_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op = 'INSERT' then
   insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'created','Order created');
 else
   if new.status is distinct from old.status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'status',old.status::text || ' → ' || new.status::text);
   end if;
   if new.payment_status is distinct from old.payment_status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'payment',old.payment_status || ' → ' || new.payment_status);
   end if;
   if new.fulfillment_status is distinct from old.fulfillment_status or new.shipping_status is distinct from old.shipping_status then
     insert into order_operations_log(order_id,order_number,actor_id,event,message) values(new.id,new.order_number,auth.uid(),'fulfillment',new.fulfillment_status || ' / ' || new.shipping_status);
   end if;
 end if;
 return new;
end $$;
create trigger orders_intelligence_events after insert or update on public.orders for each row execute function public.capture_order_intelligence_event();

create or replace function public.stamp_order_intelligence_payment() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if tg_op='INSERT' or new.payment_status is distinct from old.payment_status then
  if new.payment_status='paid' then new.paid_at := coalesce(new.paid_at,now()); end if;
  if new.payment_status='refunded' then new.refund_request_status := 'completed'; end if;
 end if;
 return new;
end $$;
create trigger orders_intelligence_payment before insert or update on public.orders for each row execute function public.stamp_order_intelligence_payment();

-- Shared, parameterized filter. No raw SQL from the model, no wildcard interpolation.
create or replace function public.nemesis_order_scope(p jsonb) returns setof public.orders
language sql stable as $$
 select o.* from public.orders o where
   (nullif(p->>'id','') is null or o.id = (p->>'id')::uuid)
   and (nullif(p->>'orderNumber','') is null or o.order_number = (p->>'orderNumber')::bigint)
   and (nullif(p->>'customerId','') is null or o.user_id = (p->>'customerId')::uuid)
   and (nullif(p->>'customerOrderId','') is null or exists(select 1 from public.orders anchor where anchor.id=(p->>'customerOrderId')::uuid and (case when anchor.user_id is not null then o.user_id=anchor.user_id when nullif(anchor.customer_email,'') is not null then o.user_id is null and lower(o.customer_email)=lower(anchor.customer_email) else o.id=anchor.id end)))
   and (nullif(p->>'email','') is null or lower(o.customer_email) = lower(p->>'email'))
   and (nullif(p->>'customer','') is null or position(lower(p->>'customer') in lower(o.shipping_name)) > 0 or position(lower(p->>'customer') in lower(coalesce(o.customer_email,''))) > 0)
   and (nullif(p->>'status','') is null or o.status::text = p->>'status')
   and (nullif(p->>'paymentStatus','') is null or o.payment_status = p->>'paymentStatus')
   and (nullif(p->>'fulfillmentStatus','') is null or o.fulfillment_status = p->>'fulfillmentStatus')
   and (nullif(p->>'shippingStatus','') is null or o.shipping_status = p->>'shippingStatus')
   and (nullif(p->>'from','') is null or o.created_at >= (p->>'from')::timestamptz)
   and (nullif(p->>'to','') is null or o.created_at < (p->>'to')::timestamptz)
   and (nullif(p->>'minValueMicros','') is null or o.total_micros >= (p->>'minValueMicros')::bigint)
   and (nullif(p->>'maxValueMicros','') is null or o.total_micros <= (p->>'maxValueMicros')::bigint)
   and (nullif(p->>'product','') is null or exists(select 1 from public.order_items i where i.order_id=o.id and position(lower(p->>'product') in lower(i.product_name)) > 0))
   and (nullif(p->>'minQuantity','') is null or (select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id=o.id) >= (p->>'minQuantity')::int)
   and (nullif(p->>'maxQuantity','') is null or (select coalesce(sum(i.quantity),0) from public.order_items i where i.order_id=o.id) <= (p->>'maxQuantity')::int);
$$;

create or replace function public.nemesis_order_flags(o public.orders, p jsonb) returns jsonb
language sql stable set search_path = public, pg_temp as $$
 select coalesce(jsonb_agg(x.flag) filter(where x.flag is not null),'[]'::jsonb) from (values
 (case when o.payment_status='paid' and o.status not in ('cancelled','completed') and o.fulfillment_status not in ('shipped','delivered') then jsonb_build_object('severity','high','reason','Paid but not shipped','next','Verify fulfillment and prepare shipment.') end),
 (case when o.status='processing' and o.updated_at < now()-make_interval(hours=>least(720,greatest(1,coalesce((p->>'processingHours')::int,72)))) then jsonb_build_object('severity','high','reason','Processing without a recent update','next','Investigate stock, payment, and dispatch.') end),
 (case when o.status not in ('cancelled','completed') and o.fulfillment_status not in ('shipped','delivered') and coalesce(o.fulfillment_due_at,o.created_at+make_interval(hours=>least(720,greatest(1,coalesce((p->>'fulfillmentHours')::int,48))))) < now() then jsonb_build_object('severity','high','reason','Expected fulfillment time exceeded','next','Confirm dispatch timing with the fulfillment team.') end),
 (case when o.shipping_status='delayed' or (o.fulfillment_status='shipped' and o.expected_delivery_at < now()) then jsonb_build_object('severity','high','reason','Shipment delayed or delivery estimate exceeded','next','Check carrier tracking and notify the customer.') end),
 (case when o.payment_status='unpaid' and o.status <> 'cancelled' and o.created_at < now()-make_interval(hours=>least(720,greatest(1,coalesce((p->>'paymentHours')::int,24)))) then jsonb_build_object('severity','medium','reason','Unpaid beyond the review threshold (may be COD)','next','Verify the payment method; do not infer a failed payment.') end),
 (case when o.status <> 'cancelled' and (o.fulfillment_status='unknown' or (o.fulfillment_status='shipped' and nullif(o.tracking_number,'') is null)) then jsonb_build_object('severity','medium','reason','Fulfillment or tracking information is incomplete','next','Verify fulfillment details before updating.') end),
 (case when (o.user_id is not null or nullif(o.customer_email,'') is not null) and (select count(*) from (select 1 from orders past where past.status='cancelled' and (case when o.user_id is not null then past.user_id=o.user_id else past.user_id is null and lower(past.customer_email)=lower(o.customer_email) end) limit 3) repeated)>=3 then jsonb_build_object('severity','medium','reason','Customer has at least three historical cancellations','next','Review customer history before further fulfillment; do not assume fraud.') end),
 (case when o.total_micros > coalesce((p->>'highValueMicros')::bigint,1000000000) then jsonb_build_object('severity','medium','reason','Order value exceeds the configured review threshold','next','Review payment legitimacy before dispatch.') end),
 (case when (select coalesce(sum(quantity),0) from order_items where order_id=o.id) > coalesce((p->>'highQuantity')::int,20) then jsonb_build_object('severity','medium','reason','Quantity exceeds the configured review threshold','next','Verify bulk purchasing intent and stock availability.') end),
 (case when o.refund_request_status='requested' and o.refund_requested_at < now()-interval '48 hours' then jsonb_build_object('severity','high','reason','Refund request awaiting resolution for over 48 hours','next','Review in the payment provider; this assistant cannot transfer funds.') end)
 ) x(flag);
$$;

-- Build the full admin widget only for the bounded page, never for every matched row.
create or replace function public.nemesis_order_json(o public.orders, detail boolean, p jsonb, p_flags jsonb default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
 select (case when detail then to_jsonb(o) else jsonb_build_object(
  'id',o.id,'order_number',o.order_number,'status',o.status,'payment_status',o.payment_status,'payment_method',o.payment_method,
  'fulfillment_status',o.fulfillment_status,'shipping_status',o.shipping_status,'shipping_name',o.shipping_name,
  'total_micros',o.total_micros,'created_at',o.created_at,'updated_at',o.updated_at) end)
 || jsonb_build_object('flags',coalesce(p_flags,nemesis_order_flags(o,p)),'quantity',(select coalesce(sum(i.quantity),0) from order_items i where i.order_id=o.id))
 || case when detail then jsonb_build_object(
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from order_items i where i.order_id=o.id),'[]'::jsonb),
  'timeline',coalesce((select jsonb_agg(to_jsonb(e)-'actor_id' order by e.created_at desc,e.id desc) from (select * from order_operations_log where order_id=o.id order by created_at desc,id desc limit 200) e),'[]'::jsonb),
  'timelineCount',(select count(*) from order_operations_log where order_id=o.id)) else '{}'::jsonb end;
$$;

create or replace function public.nemesis_orders_read(p jsonb default '{}', p_mode text default 'search') returns jsonb
language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '8s' as $$
declare result jsonb; total_count bigint; lim int := least(50,greatest(1,coalesce((p->>'limit')::int,20))); begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 if p_mode not in ('search','detail','report','customers','problems') then raise exception 'Invalid report mode'; end if;
 if p_mode in ('report','customers','problems') and not pg_try_advisory_xact_lock(hashtext('nemesis-order-aggregate')) then raise exception 'Another order aggregate report is running; retry shortly or use filtered order search'; end if;
 if p_mode='detail' and nullif(p->>'id','') is null and nullif(p->>'orderNumber','') is null then raise exception 'Exact order required'; end if;
 -- Inline the private SQL scope for indexed keyset search/detail reads. Do not materialize
 -- every full order just to retrieve one page; only aggregates use the shared snapshot.
 if p_mode in ('search','detail') then
  select count(*) into total_count from nemesis_order_scope(p);
  with page as materialized (
   select o.* from nemesis_order_scope(p) o
   where nullif(p->>'cursorAt','') is null or (o.created_at,o.id)<((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid)
   order by created_at desc,id desc limit lim+1
  ), shown as (select * from page order by created_at desc,id desc limit lim)
  select jsonb_build_object('generatedAt',now(),'mode',p_mode,'filters',p,'baseCurrency','USD','total',total_count,
   'hasMore',(select count(*)>lim from page),
   'rows',coalesce((select jsonb_agg(nemesis_order_json(row(s.*)::public.orders,p_mode='detail',p) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
   'metrics',null,'topProducts','[]'::jsonb,'highestRevenueProducts','[]'::jsonb,'customers','[]'::jsonb,'combinations','[]'::jsonb,'daily','[]'::jsonb) into result;
  return result;
 end if;

 with scope as materialized (select * from nemesis_order_scope(p)),
 candidates as (
   select o.* from scope o where p_mode='problems' or
     (nullif(p->>'cursorAt','') is null or (o.created_at,o.id) < ((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid))
   order by created_at desc,id desc limit case when p_mode='problems' then null else lim+1 end
 ),
 flagged as materialized (select o.id,o.created_at,row(o.*)::public.orders as order_row,nemesis_order_flags(row(o.*)::public.orders,p) as flags from candidates o),
 page as (select * from flagged where (p_mode <> 'problems' or jsonb_array_length(flags)>0)
   and (p_mode <> 'problems' or nullif(p->>'cursorAt','') is null or (case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end) > coalesce((p->>'cursorSeverity')::int,0) or ((case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end) = coalesce((p->>'cursorSeverity')::int,0) and (created_at,id)>((p->>'cursorAt')::timestamptz,(p->>'cursorId')::uuid)))
   order by case when p_mode='problems' then case when flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end else 0 end, case when p_mode='problems' then created_at end asc,created_at desc,case when p_mode='problems' then id end asc,id desc limit lim+1),
 shown as (select * from page order by case when p_mode='problems' and flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end,case when p_mode='problems' then created_at end asc,created_at desc,case when p_mode='problems' then id end asc,id desc limit lim),
 eligible as materialized(select * from scope where payment_status='paid' and status <> 'cancelled'),
 customer as (
  select md5(coalesce(user_id::text,lower(nullif(customer_email,'')),'order:'||id::text)) as key, min(id::text) as sample_order_id,
   min(shipping_name) as name, count(*) as orders,
   count(*) filter(where payment_status='paid' and status <> 'cancelled') as purchases,
   coalesce(sum(total_micros) filter(where payment_status='paid' and status <> 'cancelled'),0) as spending,
   count(*) filter(where status='cancelled') as cancellations, count(*) filter(where payment_status='refunded') as refunds,
   max(created_at) as last_order, min(created_at) as first_order,
   max(created_at) filter(where payment_status='paid' and status <> 'cancelled') as last_purchase,
   min(created_at) filter(where payment_status='paid' and status <> 'cancelled') as first_purchase
  from scope group by 1
 ),
 customer_cohort as (select * from customer
    where (not coalesce((p->>'inactiveOnly')::boolean,false) or last_purchase < now()-make_interval(days=>least(3650,greatest(1,coalesce((p->>'inactiveDays')::int,90)))))
      and (not coalesce((p->>'repeatOnly')::boolean,false) or purchases>1)
      and (not coalesce((p->>'highRiskOnly')::boolean,false) or cancellations>=3 or refunds>=2)
 ),
 previous as (select * from nemesis_order_scope((p-'cursorAt'-'cursorId') || jsonb_build_object('from',((p->>'from')::timestamptz-((p->>'to')::timestamptz-(p->>'from')::timestamptz)),'to',p->>'from')) where p_mode='report'),
 products as (select coalesce(i.product_id::text,i.product_name) as key,min(i.product_name) as name,sum(i.quantity) as units,sum(i.line_total_micros) as sales from eligible o join order_items i on i.order_id=o.id group by 1),
 daily as (select (created_at at time zone 'UTC')::date as day,count(*) as orders,coalesce(sum(total_micros) filter(where payment_status='paid' and status<>'cancelled'),0) as revenue from scope group by 1),
 basket as (select distinct o.id as order_id,coalesce(i.product_id::text,'name:'||i.product_name) as key,i.product_name as name from eligible o join order_items i on i.order_id=o.id where coalesce((p->>'includeCombinations')::boolean,false)),
 combos as (select min(a.name) as first,min(b.name) as second,count(distinct a.order_id) as orders from basket a join basket b on b.order_id=a.order_id and a.key<b.key group by a.key,b.key order by 3 desc,1,2 limit 10)
 select jsonb_build_object(
  'generatedAt',now(),'mode',p_mode,'filters',p,'baseCurrency','USD',
  'rows',coalesce((select jsonb_agg(nemesis_order_json(s.order_row,false,p,s.flags)
    order by case when p_mode='problems' and s.flags @> '[{"severity":"high"}]'::jsonb then 0 else 1 end,case when p_mode='problems' then s.created_at end asc,s.created_at desc,case when p_mode='problems' then s.id end asc,s.id desc) from shown s),'[]'::jsonb),
  'hasMore',(select count(*)>lim from page),
  'total',(select count(*) from scope),
  'metrics',case when p_mode in ('report','customers') then jsonb_build_object(
    'orders',(select count(*) from scope),'paidOrders',(select count(*) from eligible),
    'revenueMicros',(select coalesce(sum(total_micros),0) from eligible),
    'aovMicros',(select coalesce(round(avg(total_micros)),0) from eligible),
    'cancelled',(select count(*) from scope where status='cancelled'),
    'refunded',(select count(*) from scope where payment_status='refunded'),
    'unpaid',(select count(*) from scope where payment_status='unpaid'),
    'statusCounts',(select jsonb_object_agg(status,n) from (select status,count(*) n from scope group by status) z),
    'paymentCounts',(select jsonb_object_agg(payment_status,n) from (select payment_status,count(*) n from scope group by payment_status) z),
    'fulfillmentCounts',(select jsonb_object_agg(fulfillment_status,n) from (select fulfillment_status,count(*) n from scope group by fulfillment_status) z),
    'repeatCustomers',(select count(*) from customer where purchases>1),
    'oneTimeCustomers',(select count(*) from customer where purchases=1),
    'inactiveCustomers',(select count(*) from customer where last_purchase < now()-make_interval(days=>least(3650,greatest(1,coalesce((p->>'inactiveDays')::int,90))))),
    'cohortCustomers',(select count(*) from customer_cohort),
    'cohortSpendingMicros',(select coalesce(sum(spending),0) from customer_cohort),
    'cohortOrders',(select coalesce(sum(orders),0) from customer_cohort),
    'cohortPurchases',(select coalesce(sum(purchases),0) from customer_cohort),
    'previousOrders',(select count(*) from previous),
    'previousRevenueMicros',(select coalesce(sum(total_micros) filter(where payment_status='paid' and status<>'cancelled'),0) from previous)
  ) else null end,
  'topProducts',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(t) order by t.units desc,t.key) from (select * from products order by units desc,key limit 10) t),'[]') else '[]'::jsonb end,
  'highestRevenueProducts',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(t) order by t.sales desc,t.key) from (select * from products order by sales desc,key limit 10) t),'[]') else '[]'::jsonb end,
  'customers',case when p_mode in ('report','customers') then coalesce((select jsonb_agg(to_jsonb(t) order by t.spending desc,t.key) from (select *,case when purchases>1 then extract(epoch from last_purchase-first_purchase)/86400/(purchases-1) else null end as frequency_days from customer_cohort
    order by spending desc,key limit 20) t),'[]') else '[]'::jsonb end,
  'combinations',case when p_mode='customers' then coalesce((select jsonb_agg(to_jsonb(c) order by c.orders desc,c.first,c.second) from combos c),'[]') else '[]'::jsonb end,
  'daily',case when p_mode='report' then coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from (select * from daily order by day desc limit 60) d),'[]') else '[]'::jsonb end
 ) into result;
 return result;
end $$;

-- Validate operation semantics both when preparing and applying. No arbitrary column patches.
create or replace function public.nemesis_validate_order_action(o public.orders, a text, v jsonb) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
 if exists(select 1 from jsonb_object_keys(v) as fields(key) where key <> all(case a
  when 'status' then array['status'] when 'refund_request' then array['text'] when 'note' then array['text'] when 'notification' then array['text']
  when 'fulfillment' then array['fulfillmentStatus','trackingNumber','trackingUrl','carrier','expectedDeliveryAt','fulfillmentDueAt']
  when 'shipping' then array['shippingStatus','trackingNumber','trackingUrl','carrier','expectedDeliveryAt','fulfillmentDueAt'] else array[]::text[] end)) then raise exception 'Payload contains fields unrelated to this operation'; end if;
 if a='status' then
  if coalesce(v->>'status','') not in ('pending','processing','completed','cancelled') then raise exception 'Invalid status'; end if;
  if o.status='cancelled' then raise exception 'Cancelled orders cannot be reopened here'; end if;
  if o.status='completed' and v->>'status'<>'completed' then raise exception 'Completed orders require a manual review; use a refund request if appropriate'; end if;
  if o.payment_status='refunded' then raise exception 'Refunded orders cannot change status here'; end if;
  if v->>'status'='cancelled' and o.payment_status='paid' then raise exception 'Paid orders require a refund review instead of cancellation'; end if;
  if v->>'status'='cancelled' and o.fulfillment_status in ('shipped','delivered') then raise exception 'Shipped orders cannot be cancelled here'; end if;
  if v->>'status'='completed' and (o.payment_status<>'paid' or o.fulfillment_status<>'delivered') then raise exception 'Completion requires paid and delivered'; end if;
  if o.status::text=v->>'status' then raise exception 'Status is unchanged'; end if;
 elsif a='refund_request' then
  if o.payment_status<>'paid' or o.refund_request_status<>'none' then raise exception 'Requires paid order without an existing refund request'; end if;
  if length(trim(coalesce(v->>'text','')))<3 then raise exception 'Refund reason required'; end if;
 elsif a in ('note','notification') then
  if length(trim(coalesce(v->>'text',''))) not between 1 and (case when a='notification' then 200 else 2000 end) then raise exception 'Invalid message length'; end if;
  if a='notification' and o.user_id is null then raise exception 'Guest notifications require a manual email integration'; end if;
 elsif a='fulfillment' then
  if coalesce(v->>'fulfillmentStatus','') not in ('unfulfilled','packed','shipped','delivered') then raise exception 'Invalid fulfillment status'; end if;
  if o.status='cancelled' or o.payment_status='refunded' then raise exception 'Cannot fulfill cancelled/refunded order'; end if;
  if o.status='completed' and o.fulfillment_status<>'unknown' and v->>'fulfillmentStatus'<>o.fulfillment_status then raise exception 'Completed fulfillment cannot be reversed here'; end if;
  if v->>'fulfillmentStatus' in ('shipped','delivered') and o.payment_status<>'paid' and o.payment_method<>'cod' then raise exception 'Payment required before dispatch (except COD)'; end if;
  if o.fulfillment_status='delivered' and v->>'fulfillmentStatus'<>'delivered' then raise exception 'Delivered fulfillment cannot be reversed here'; end if;
  if o.fulfillment_status='shipped' and v->>'fulfillmentStatus' in ('unfulfilled','packed') then raise exception 'Shipped fulfillment cannot be reversed here'; end if;
  if v->>'fulfillmentStatus'='delivered' and o.fulfillment_status<>'shipped' then raise exception 'Record shipment before delivery'; end if;
  if v->>'fulfillmentStatus'='shipped' and nullif(coalesce(v->>'trackingNumber',o.tracking_number),'') is null then raise exception 'Tracking number required for shipment'; end if;
 elsif a='shipping' then
  if o.status='cancelled' or o.payment_status='refunded' then raise exception 'Cannot change shipping on cancelled/refunded order'; end if;
  if v ? 'shippingStatus' and coalesce(v->>'shippingStatus','') not in ('pending','in_transit','delayed','delivered') then raise exception 'Invalid shipping status'; end if;
  if v->>'shippingStatus' in ('in_transit','delayed','delivered') and o.fulfillment_status not in ('shipped','delivered') then raise exception 'Record fulfillment shipment first'; end if;
  if v->>'shippingStatus'='delivered' and o.fulfillment_status<>'delivered' then raise exception 'Record delivered fulfillment first'; end if;
  if o.fulfillment_status='delivered' and v ? 'shippingStatus' and v->>'shippingStatus'<>'delivered' then raise exception 'Delivered shipping cannot be reversed'; end if;
 else raise exception 'Unsupported order action'; end if;
 if coalesce(length(v->>'trackingNumber'),0)>200 or coalesce(length(v->>'carrier'),0)>120 or coalesce(length(v->>'trackingUrl'),0)>1000 or coalesce(length(v->>'text'),0)>2000 then raise exception 'Operation text too long'; end if;
 if v ? 'trackingUrl' and coalesce(v->>'trackingUrl','') !~ '^https://[^[:space:]]+$' then raise exception 'Tracking URL must use HTTPS'; end if;
 if v ? 'expectedDeliveryAt' and (v->>'expectedDeliveryAt')::timestamptz < o.created_at then raise exception 'Delivery estimate precedes order'; end if;
 if v ? 'fulfillmentDueAt' and (v->>'fulfillmentDueAt')::timestamptz < o.created_at then raise exception 'Fulfillment deadline precedes order'; end if;
end $$;

create or replace function public.nemesis_prepare_order_action(p_order_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; preview order_action_previews; begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 select * into o from orders where id=p_order_id;
 if not found then raise exception 'Order not found'; end if;
 perform nemesis_validate_order_action(o,p_action,p_payload);
 delete from order_action_previews where actor_id=auth.uid() and expires_at < now()-interval '30 days';
 insert into order_action_previews(actor_id,order_id,order_version,action,payload) values(auth.uid(),o.id,o.updated_at,p_action,p_payload) returning * into preview;
 return jsonb_build_object('previewId',preview.id,'orderId',o.id,'orderNumber',o.order_number,'version',o.updated_at,'oldStatus',o.status,'oldFulfillment',o.fulfillment_status,'oldShipping',o.shipping_status,'expiresAt',preview.expires_at);
end $$;

create or replace function public.nemesis_apply_order_action(p_preview_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '8s' as $$
declare pr order_action_previews; o orders; v jsonb; failure text; begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 select * into pr from order_action_previews where id=p_preview_id and actor_id=auth.uid() for update;
 if not found then raise exception 'Approval preview not found for this administrator'; end if;
 if pr.used_at is not null then raise exception 'This approval has already been used'; end if;
 update order_action_previews set used_at=now() where id=pr.id;
 begin
  if pr.expires_at < now() then raise exception 'Preview expired; generate a new preview'; end if;
  select * into o from orders where id=pr.order_id for update;
  if not found then raise exception 'Order no longer exists'; end if;
  if o.updated_at is distinct from pr.order_version then raise exception 'Order changed after preview; regenerate before approval'; end if;
  v := pr.payload;
  perform nemesis_validate_order_action(o,pr.action,v);
  if pr.action='status' then
   -- Existing stock snapshot trigger handles cancellation/restocking atomically.
   update orders set status=(v->>'status')::order_status where id=o.id;
  elsif pr.action='refund_request' then
   update orders set refund_request_status='requested',refund_requested_at=now() where id=o.id;
  elsif pr.action='fulfillment' then
   update orders set fulfillment_status=v->>'fulfillmentStatus',
    shipping_status=case v->>'fulfillmentStatus' when 'shipped' then 'in_transit' when 'delivered' then 'delivered' else 'pending' end,
    fulfilled_at=case when v->>'fulfillmentStatus' in ('shipped','delivered') then coalesce(fulfilled_at,now()) else fulfilled_at end,
    shipped_at=case when v->>'fulfillmentStatus'='shipped' then coalesce(shipped_at,now()) else shipped_at end,
    delivered_at=case when v->>'fulfillmentStatus'='delivered' then coalesce(delivered_at,now()) else delivered_at end where id=o.id;
  elsif pr.action='notification' then
   insert into order_messages(order_id,sender_type,sender_id,sender_name,message) values(o.id,'admin',auth.uid(),'Store administrator',v->>'text');
  end if;
  if pr.action in ('shipping','fulfillment') then
   update orders set tracking_number=coalesce(v->>'trackingNumber',tracking_number),tracking_url=coalesce(v->>'trackingUrl',tracking_url),shipping_carrier=coalesce(v->>'carrier',shipping_carrier),
    expected_delivery_at=coalesce((v->>'expectedDeliveryAt')::timestamptz,expected_delivery_at),fulfillment_due_at=coalesce((v->>'fulfillmentDueAt')::timestamptz,fulfillment_due_at),
    shipping_status=case when pr.action='shipping' then coalesce(v->>'shippingStatus',shipping_status) else shipping_status end where id=o.id;
  end if;
  -- Notes/notifications also advance the version; two stale approvals cannot overwrite context.
  update orders set updated_at=clock_timestamp() where id=o.id;
  insert into order_operations_log(order_id,order_number,actor_id,event,message) values(o.id,o.order_number,auth.uid(),pr.action,case when pr.action in ('note','notification','refund_request') then coalesce(v->>'text',pr.action) else v::text end);
 exception when others then
  get stacked diagnostics failure=message_text;
 end;
 if failure is not null then
  insert into order_operations_log(order_id,order_number,actor_id,event,message,success) values(pr.order_id,(select order_number from orders where id=pr.order_id),auth.uid(),pr.action,failure,false);
  return jsonb_build_object('ok',false,'error',failure);
 end if;
 return jsonb_build_object('ok',true,'orderId',pr.order_id,'action',pr.action);
end $$;

revoke all on function public.nemesis_order_json(public.orders,boolean,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.stamp_order_intelligence_payment() from public, anon, authenticated;
revoke all on function public.capture_order_intelligence_event() from public, anon, authenticated;
revoke all on function public.nemesis_order_scope(jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_order_flags(public.orders,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_validate_order_action(public.orders,text,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_orders_read(jsonb,text) from public, anon, authenticated;
revoke all on function public.nemesis_prepare_order_action(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_apply_order_action(uuid) from public, anon, authenticated;
grant execute on function public.nemesis_orders_read(jsonb,text) to authenticated;
grant execute on function public.nemesis_prepare_order_action(uuid,text,jsonb) to authenticated;
grant execute on function public.nemesis_apply_order_action(uuid) to authenticated;
