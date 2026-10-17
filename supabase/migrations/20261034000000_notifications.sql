-- -----------------------------------------------------------------------------
--  NOTIFICATIONS — the bell in both headers, fed by the database itself
--
--  One row per (recipient, event). The rows are written by triggers, not by the
--  app, so every door into an order produces the same notification: the
--  checkout RPC, the admin form, the chat API, a SQL fix at 2 a.m.
--
--    new_order       → every admin, when a customer places an order
--    order_status    → the buyer, when the status of their order changes
--    order_cancelled → every admin, when an order is cancelled
--    payment         → every admin, when an order is marked paid
--    order_message   → the other side of an inquiry (customer ⇄ admin)
--
--  The title / body / href are stored resolved: the bell and the notifications
--  page render rows without a join, and a notification keeps working after the
--  order's title or the profile behind it changes. `href` is the exact page the
--  click should land on (`/orders/<id>` for a customer, `/nemesis/orders/<id>`
--  for an admin), so both headers share one component.
--
--  RLS: a recipient reads, marks read and deletes **their own** rows only. There
--  is no INSERT policy – the trigger functions (security definer) are the only
--  writers, so a customer can never forge a notification for somebody else.
--  The SSE endpoint (/api/notifications/stream) reads through this same RLS.
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text not null,
  order_id uuid references public.orders (id) on delete cascade,
  actor_name text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.notifications add constraint notifications_kind_check
    check (kind in ('new_order', 'order_status', 'order_cancelled', 'payment', 'order_message'));
exception
  when duplicate_object then null;
end $$;

-- the bell reads newest-first; the partial index is the unread count
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc, id desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_order_idx on public.notifications (order_id) where order_id is not null;

comment on table public.notifications is 'Per-recipient notifications, written by triggers on orders/order_messages; read through RLS';
comment on column public.notifications.href is 'Where a click lands: /orders/<id> for customers, /nemesis/orders/<id> for admins';

-- 1. RLS ---------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "Recipients read their notifications" on public.notifications;
create policy "Recipients read their notifications"
  on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "Recipients mark their notifications" on public.notifications;
create policy "Recipients mark their notifications"
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

drop policy if exists "Recipients delete their notifications" on public.notifications;
create policy "Recipients delete their notifications"
  on public.notifications for delete to authenticated
  using (recipient_id = auth.uid());

/**
 * The UPDATE policy above may only ever touch `read_at` – a notification is a
 * record of something that happened, not a draft. The trigger rejects every
 * other change (including moving a row to another recipient).
 */
create or replace function public.notifications_read_only()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.recipient_id, new.kind, new.title, new.body, new.href, new.order_id, new.actor_name, new.created_at)
     is distinct from
     (old.id, old.recipient_id, old.kind, old.title, old.body, old.href, old.order_id, old.actor_name, old.created_at)
  then
    raise exception 'Only the read state of a notification can change.';
  end if;
  return new;
end $$;

drop trigger if exists notifications_read_only on public.notifications;
create trigger notifications_read_only
  before update on public.notifications
  for each row execute function public.notifications_read_only();

-- 2. helpers -----------------------------------------------------------------
/** Every admin, except the one performing the action (no self-notifications). */
create or replace function public.notification_admins(p_actor uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.is_admin
    and p.id <> coalesce(p_actor, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

revoke all on function public.notification_admins(uuid) from public;

-- 3. a new order → every admin ------------------------------------------------
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
  select count(*) into v_items from public.order_items where order_id = new.id;
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

drop trigger if exists orders_notify_new on public.orders;
create trigger orders_notify_new
  after insert on public.orders
  for each row execute function public.orders_notify_new();

-- 4. status / payment changes → the buyer and the admins -----------------------
create or replace function public.orders_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  v_ref := '#' || lpad(new.order_number::text, 4, '0');

  -- the customer: their order moved
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
  after update of status, payment_status on public.orders
  for each row execute function public.orders_notify_status();

-- 5. an inquiry message → the other side --------------------------------------
create or replace function public.order_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_customer uuid;
  v_ref text;
begin
  select o.order_number, o.user_id into v_number, v_customer from public.orders o where o.id = new.order_id;
  v_ref := '#' || lpad(coalesce(v_number, 0)::text, 4, '0');

  if new.sender_type = 'customer' then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'order_message', 'New inquiry · Order ' || v_ref,
      left(new.message, 140), '/nemesis/orders/' || new.order_id, new.order_id,
      coalesce(new.sender_name, 'A customer')
    from public.notification_admins(new.sender_id) as a(id);
  elsif v_customer is not null and v_customer <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    values (v_customer, 'order_message', 'Admin replied · Order ' || v_ref,
      left(new.message, 140), '/orders/' || new.order_id, new.order_id, 'Admin');
  end if;

  return new;
end $$;

drop trigger if exists order_messages_notify on public.order_messages;
create trigger order_messages_notify
  after insert on public.order_messages
  for each row execute function public.order_messages_notify();
