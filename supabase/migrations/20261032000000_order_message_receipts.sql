-- -----------------------------------------------------------------------------
--  READ RECEIPTS — allow the *recipient* to stamp delivered_at / seen_at
--
--  Migration 17 made the thread immutable: SELECT + INSERT only. That also blocked
--  the read receipts added in 18 – the recipient's UPDATE matched no rows under RLS
--  and the ✓ / ✓✓ marks stayed grey. This opens exactly one door:
--
--    * the recipient may update the **other side's** messages of an order they take
--      part in (customer → admin messages, admin → customer messages);
--    * only `delivered_at` / `seen_at` may change, only into the future from null,
--      and nothing else about the row (a trigger enforces it, since RLS cannot
--      restrict columns);
--    * authors can never touch their own messages, and neither side can edit or
--      delete the text.
-- -----------------------------------------------------------------------------

drop policy if exists "Recipients can mark messages delivered and seen" on public.order_messages;
create policy "Recipients can mark messages delivered and seen"
  on public.order_messages for update
  using (
    (sender_type = 'admin' and exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    ))
    or (sender_type = 'customer' and public.is_admin())
  )
  with check (
    (sender_type = 'admin' and exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id and o.user_id = auth.uid()
    ))
    or (sender_type = 'customer' and public.is_admin())
  );

comment on policy "Recipients can mark messages delivered and seen" on public.order_messages is
  'Read receipts only: the recipient stamps delivered_at / seen_at on the other side''s messages (see public.order_messages_receipts_only)';

/**
 * Keeps the threads immutable while the receipts above are written: anything other
 * than the two receipt columns – or rewriting a receipt that is already set – is
 * rejected. This is what lets the UPDATE policy stay so narrow.
 */
create or replace function public.order_messages_receipts_only()
returns trigger
language plpgsql
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.sender_type is distinct from old.sender_type
     or new.sender_id is distinct from old.sender_id
     or new.sender_name is distinct from old.sender_name
     or new.sender_avatar_url is distinct from old.sender_avatar_url
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Order messages are immutable – only the delivered / seen receipts can be set';
  end if;

  if old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
    raise exception 'The delivered receipt cannot be rewritten';
  end if;
  if old.seen_at is not null and new.seen_at is distinct from old.seen_at then
    raise exception 'The seen receipt cannot be rewritten';
  end if;
  if new.delivered_at is null and old.delivered_at is not null then
    raise exception 'The delivered receipt cannot be cleared';
  end if;
  if new.seen_at is null and old.seen_at is not null then
    raise exception 'The seen receipt cannot be cleared';
  end if;

  return new;
end;
$$;

drop trigger if exists order_messages_receipts_only on public.order_messages;
create trigger order_messages_receipts_only
  before update on public.order_messages
  for each row execute function public.order_messages_receipts_only();
