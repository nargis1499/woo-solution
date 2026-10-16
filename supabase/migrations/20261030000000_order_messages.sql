-- -----------------------------------------------------------------------------
--  ORDER MESSAGES — the turn-based inquiry chat on an order
--
--  * one thread per order; the two sides are the customer and the store admin(s)
--  * `sender_type` decides who is talking: 'customer' | 'admin'
--  * author name/avatar are snapshotted so the thread keeps rendering after a
--    profile edit or a deleted account
--  * messages are immutable: SELECT + INSERT policies only, no update/delete
--  * the 200-character limit lives here as a check constraint; the turn rule
--    ("a customer writes again only after an admin reply") is enforced in
--    src/app/api/orders/[id]/chat/route.ts, which is the only write path
-- -----------------------------------------------------------------------------

create table if not exists public.order_messages (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  sender_type       text not null check (sender_type in ('customer', 'admin')),
  sender_id         uuid,
  sender_name       text,
  sender_avatar_url text,
  message           text not null check (char_length(btrim(message)) between 1 and 200),
  created_at        timestamptz not null default now()
);

create index if not exists order_messages_order_created_idx on public.order_messages (order_id, created_at, id);

alter table public.order_messages enable row level security;

-- The order's owner and every admin can read the thread.
drop policy if exists "Order participants can read the thread" on public.order_messages;
create policy "Order participants can read the thread"
  on public.order_messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_messages.order_id
        and o.user_id = auth.uid()
    )
  );

-- A customer may only post to their own order, and only as 'customer';
-- 'admin' messages require the admin flag.
drop policy if exists "Order participants can post to the thread" on public.order_messages;
create policy "Order participants can post to the thread"
  on public.order_messages for insert
  with check (
    (
      sender_type = 'customer'
      and exists (
        select 1 from public.orders o
        where o.id = order_messages.order_id
          and o.user_id = auth.uid()
      )
    )
    or (sender_type = 'admin' and public.is_admin())
  );
