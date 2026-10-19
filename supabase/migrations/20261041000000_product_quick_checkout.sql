-- ============================================================================
-- Woo Solution — Migration 27: Product-level Quick Checkout
-- ============================================================================

alter table public.products
  add column if not exists quick_checkout boolean not null default false;

comment on column public.products.quick_checkout is
  'Whether the product displays the Quick Checkout button on the storefront (disabled by default).';
