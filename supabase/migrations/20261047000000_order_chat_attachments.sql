-- =============================================================================
--  Migration: Order Chat File Attachments (Admin → Customer)
--  Allows store admins to send any type of file attachment in the per-order
--  inquiry chat (`public.order_messages`), and allows customers to view and
--  download those attachments from their order page.
-- =============================================================================

-- 1. Attachment columns on `public.order_messages` ----------------------------
alter table public.order_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint check (attachment_size is null or attachment_size >= 0);

-- 2. Allow empty text caption when an admin sends an attachment, and enforce
--    that only admins can attach files. ---------------------------------------
alter table public.order_messages
  drop constraint if exists order_messages_message_check;

alter table public.order_messages
  add constraint order_messages_message_check
  check (
    char_length(btrim(message)) <= 200
    and (
      char_length(btrim(message)) >= 1
      or (sender_type = 'admin' and attachment_url is not null)
    )
  );

alter table public.order_messages
  drop constraint if exists order_messages_attachment_admin_only_check;

alter table public.order_messages
  add constraint order_messages_attachment_admin_only_check
  check (attachment_url is null or sender_type = 'admin');

-- 3. Keep attachment fields immutable in the read-receipt UPDATE trigger ------
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
     or new.attachment_url is distinct from old.attachment_url
     or new.attachment_name is distinct from old.attachment_name
     or new.attachment_type is distinct from old.attachment_type
     or new.attachment_size is distinct from old.attachment_size
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

-- 4. Include attachment filenames in customer notifications -------------------
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
  v_body text;
begin
  select o.order_number, o.user_id into v_number, v_customer from public.orders o where o.id = new.order_id;
  v_ref := '#' || lpad(coalesce(v_number, 0)::text, 4, '0');

  if new.attachment_name is not null and btrim(new.message) <> '' then
    v_body := left('📎 ' || new.attachment_name || ' · ' || btrim(new.message), 140);
  elsif new.attachment_name is not null then
    v_body := left('📎 Sent an attachment: ' || new.attachment_name, 140);
  else
    v_body := left(new.message, 140);
  end if;

  if new.sender_type = 'customer' then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    select a.id, 'order_message', 'New inquiry · Order ' || v_ref,
      v_body, '/nemesis/orders/' || new.order_id, new.order_id,
      coalesce(new.sender_name, 'A customer')
    from public.notification_admins(new.sender_id) as a(id);
  elsif v_customer is not null and v_customer <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (recipient_id, kind, title, body, href, order_id, actor_name)
    values (v_customer, 'order_message', 'Admin replied · Order ' || v_ref,
      v_body, '/orders/' || new.order_id, new.order_id, 'Admin');
  end if;

  return new;
end $$;

-- 5. Ensure "media" bucket accepts any file type up to 50 MB for attachments --
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 52428800, null)
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit),
            allowed_mime_types = null
    $sql$;
  end if;
end
$$;
