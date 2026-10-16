-- =============================================================================
--  Woo Solution – dashboard customer counts
--
--  `20261026000000_money_micros.sql` re-created `admin_stats()` for the
--  micro-dollar move and, in the rewrite, dropped the two customer keys the
--  dashboard reads:
--
--    customers_total   number of accounts (public.profiles rows)
--    customers_30d     accounts created in the last 30 days
--
--  Without them the Customers card rendered "undefined joined in the last 30
--  days". This migration restores both keys; every other key keeps the shape
--  from the money rewrite (revenue_micros, orders_*, products_*).
-- =============================================================================

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view statistics.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'revenue_micros',          coalesce((select sum(total_micros) from public.orders where status <> 'cancelled'), 0),
    'revenue_30d_micros',      coalesce((select sum(total_micros) from public.orders
                                         where status <> 'cancelled' and created_at >= now() - interval '30 days'), 0),
    'orders_total',            (select count(*) from public.orders),
    'orders_30d',              (select count(*) from public.orders where created_at >= now() - interval '30 days'),
    'orders_pending',          (select count(*) from public.orders where status = 'pending'),
    'orders_processing',       (select count(*) from public.orders where status = 'processing'),
    'orders_completed',        (select count(*) from public.orders where status = 'completed'),
    'orders_cancelled',        (select count(*) from public.orders where status = 'cancelled'),
    'products_total',          (select count(*) from public.products),
    'products_active',         (select count(*) from public.products where is_active),
    'products_low_stock',      (select count(*) from public.products where is_active and stock <= 5),
    'categories_total',        (select count(*) from public.categories),
    'customers_total',         (select count(*) from public.profiles),
    'customers_30d',           (select count(*) from public.profiles where created_at >= now() - interval '30 days')
  ) into v;

  return v;
end $$;

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_stats() from anon;
grant execute on function public.admin_stats() to authenticated;

notify pgrst, 'reload schema';
