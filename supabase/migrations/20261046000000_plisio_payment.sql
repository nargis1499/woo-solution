-- -----------------------------------------------------------------------------
-- 29. Plisio Automated Cryptocurrency Payment Gateway
--     Adds `payment_plisio_enabled` and `payment_plisio_secret_key` to
--     `public.site_settings`, plus SECURITY DEFINER helpers so Plisio invoice
--     creation and webhook/auto-verification can atomically update orders to
--     `payment_status = 'paid'` and `status = 'processing'`.
-- -----------------------------------------------------------------------------

alter table public.site_settings
  add column if not exists payment_plisio_enabled boolean not null default false,
  add column if not exists payment_plisio_test_mode boolean not null default false,
  add column if not exists payment_plisio_secret_key text;

create or replace function public.get_plisio_order_state(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, user_id, order_number, status, payment_status, total_micros, customer_email, notes
    into v_row
    from public.orders
   where id = p_order_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'order_number', v_row.order_number,
    'status', v_row.status,
    'payment_status', v_row.payment_status,
    'total_micros', v_row.total_micros,
    'customer_email', v_row.customer_email,
    'notes', v_row.notes
  );
end;
$$;

create or replace function public.sync_plisio_order_invoice(
  p_order_id uuid,
  p_notes text,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_order_id;

  return public.get_plisio_order_state(p_order_id);
end;
$$;

create or replace function public.confirm_plisio_order_payment(
  p_order_id uuid,
  p_notes text default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set payment_status = 'paid',
         status = case when status = 'pending' then 'processing' else status end,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_order_id;

  return public.get_plisio_order_state(p_order_id);
end;
$$;

grant execute on function public.get_plisio_order_state(uuid) to anon, authenticated;
grant execute on function public.sync_plisio_order_invoice(uuid, text, text) to anon, authenticated;
grant execute on function public.confirm_plisio_order_payment(uuid, text, text) to anon, authenticated;
