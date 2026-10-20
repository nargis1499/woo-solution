-- =============================================================================
--  Migration: Fix `new_order` Notification Item Count
--  Because `place_order` inserts `public.orders` before inserting `public.order_items`,
--  an `after insert on public.orders` trigger saw 0 items. This migration:
--    1. Allows internal updates to `notifications.body` when syncing item counts.
--    2. Adds an `after insert on public.order_items` trigger that updates the
--       `new_order` notification body with the total quantity (`sum(quantity)`).
--    3. Backfills any existing `new_order` notifications that say "0 items".
-- =============================================================================

create or replace function public.notifications_read_only()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.recipient_id, new.kind, new.title, new.href, new.order_id, new.actor_name, new.created_at)
     is distinct from
     (old.id, old.recipient_id, old.kind, old.title, old.href, old.order_id, old.actor_name, old.created_at)
  then
    raise exception 'Only the read state of a notification can change.';
  end if;

  if new.body is distinct from old.body and old.kind <> 'new_order' then
    raise exception 'Only the read state of a notification can change.';
  end if;

  return new;
end $$;

create or replace function public.orders_notify_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
  v_ref text;
begin
  select coalesce(sum(quantity), 0)::integer
    into v_items
    from public.order_items
   where order_id = new.id;

  v_ref := '#' || lpad(new.order_number::text, 4, '0');

  insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
  select
    a.id,
    'new_order',
    'New order ' || v_ref,
    coalesce(new.shipping_name, 'A customer') || ' placed an order · ' || v_items
      || case when v_items = 1 then ' item' else ' items' end,
    '/nemesis/orders/' || new.id,
    new.id,
    coalesce(new.shipping_name, 'Customer')
  from public.notification_admins(auth.uid()) as a(id);

  return new;
end $$;

create or replace function public.order_items_sync_new_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
  v_name  text;
begin
  select coalesce(sum(quantity), 0)::integer
    into v_items
    from public.order_items
   where order_id = new.order_id;

  select coalesce(shipping_name, 'A customer')
    into v_name
    from public.orders
   where id = new.order_id;

  update public.notifications
     set body = coalesce(v_name, 'A customer') || ' placed an order · ' || v_items
       || case when v_items = 1 then ' item' else ' items' end
   where order_id = new.order_id
     and kind = 'new_order';

  return new;
end $$;

drop trigger if exists order_items_sync_notification on public.order_items;
create trigger order_items_sync_notification
  after insert on public.order_items
  for each row execute function public.order_items_sync_new_order_notification();

-- Backfill existing `new_order` notifications that say "0 items"
update public.notifications n
   set body = regexp_replace(
     n.body,
     '\m0 items\M',
     sub.total_qty::text || case when sub.total_qty = 1 then ' item' else ' items' end
   )
  from (
    select order_id, coalesce(sum(quantity), 0)::integer as total_qty
      from public.order_items
     group by order_id
  ) sub
 where n.kind = 'new_order'
   and n.order_id = sub.order_id
   and sub.total_qty > 0
   and n.body ~ '\m0 items\M';
