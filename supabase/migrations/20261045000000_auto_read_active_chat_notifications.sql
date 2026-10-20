-- =============================================================================
--  Migration: Auto-Read Active Order Chat Notifications
--  Prevents unread notification buildup when a customer or admin is actively
--  viewing or replying in an order's chat thread, while keeping notifications
--  for all other orders untouched:
--    1. Replying to an order thread marks the sender's unread `order_message`
--       notifications for that order as read.
--    2. Seeing a message (`seen_at` stamped on `order_messages`) marks the
--       recipient's unread `order_message` notifications for that order as read.
-- =============================================================================

create or replace function public.order_messages_auto_read_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. On INSERT: the person sending a reply has read the conversation for this order
  if tg_op = 'INSERT' and new.sender_id is not null then
    update public.notifications
       set read_at = coalesce(new.created_at, now())
     where order_id = new.order_id
       and kind = 'order_message'
       and recipient_id = new.sender_id
       and read_at is null;
    return new;
  end if;

  -- 2. On UPDATE of seen_at: the recipient side actively viewed this order's chat
  if tg_op = 'UPDATE' and new.seen_at is not null and old.seen_at is null then
    if new.sender_type = 'customer' then
      -- An admin saw the customer's message on this order
      update public.notifications n
         set read_at = new.seen_at
        from public.profiles p
       where n.order_id = new.order_id
         and n.kind = 'order_message'
         and n.recipient_id = p.id
         and p.is_admin = true
         and n.read_at is null;
    elsif new.sender_type = 'admin' then
      -- The customer saw the admin's message on this order
      update public.notifications n
         set read_at = new.seen_at
        from public.orders o
       where o.id = new.order_id
         and n.order_id = new.order_id
         and n.kind = 'order_message'
         and n.recipient_id = o.user_id
         and n.read_at is null;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists order_messages_auto_read_notifications_insert on public.order_messages;
create trigger order_messages_auto_read_notifications_insert
  after insert on public.order_messages
  for each row execute function public.order_messages_auto_read_notifications();

drop trigger if exists order_messages_auto_read_notifications_seen on public.order_messages;
create trigger order_messages_auto_read_notifications_seen
  after update of seen_at on public.order_messages
  for each row execute function public.order_messages_auto_read_notifications();
