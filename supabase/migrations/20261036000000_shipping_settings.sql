-- =============================================================================
--  Migration 26 – Configurable shipping options & flat shipping rate
--
--  Adds `shipping_enabled` and `shipping_rate_micros` to `public.site_settings`
--  so the admin can enable/disable shipping calculation and set the checkout
--  shipping rate under Settings → WooCommerce.
-- =============================================================================

alter table public.site_settings
  add column if not exists shipping_enabled     boolean not null default true,
  add column if not exists shipping_rate_micros bigint  not null default 5000000
    constraint site_settings_shipping_rate_micros_check check (shipping_rate_micros >= 0);

comment on column public.site_settings.shipping_enabled     is 'Whether shipping calculation is enabled at checkout';
comment on column public.site_settings.shipping_rate_micros is 'Flat checkout shipping rate in USD micro-dollars (1 USD = 1,000,000)';

create or replace function public.calculate_shipping(p_subtotal_micros bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := true;
  v_rate    bigint  := 5000000;
begin
  if coalesce(p_subtotal_micros, 0) <= 0 then
    return 0;
  end if;

  select coalesce(shipping_enabled, true),
         coalesce(shipping_rate_micros, 5000000)
    into v_enabled, v_rate
    from public.site_settings
   where id = 1;

  if not coalesce(v_enabled, true) then
    return 0;
  end if;

  return greatest(coalesce(v_rate, 0), 0);
end $$;

comment on function public.calculate_shipping(bigint) is 'Checkout shipping in USD micro-dollars from site_settings (0 when shipping_enabled is false)';
