-- ──────────────────────────────────────────────────────────────────────────
-- Migration: WooCommerce Payment Settings (Cryptocurrency Gateway & Cash on Delivery)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.site_settings
  add column if not exists payment_cod_enabled boolean not null default true,
  add column if not exists payment_crypto_enabled boolean not null default true,
  add column if not exists payment_crypto_protocols jsonb not null default '[]'::jsonb;

comment on column public.site_settings.payment_cod_enabled is
  'Whether Cash on Delivery (COD) is enabled as a checkout payment option.';

comment on column public.site_settings.payment_crypto_enabled is
  'Whether the Cryptocurrency payment gateway is enabled.';

comment on column public.site_settings.payment_crypto_protocols is
  'Configured cryptocurrency deposit wallet protocols (code, name, network, address, badge, enabled).';
