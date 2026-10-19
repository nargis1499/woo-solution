-- ============================================================================
-- Woo Solution — Migration 27: Product-level Quick Checkout & Quantity Attribute
-- ============================================================================

alter table public.products
  add column if not exists quick_checkout boolean not null default false;

comment on column public.products.quick_checkout is
  'Whether the product displays the Quick Checkout button on the storefront (disabled by default).';

alter table public.product_attributes
  add column if not exists is_quantity boolean not null default false;

comment on column public.product_attributes.is_quantity is
  'Marks this attribute as the Quantity tier axis for Quick Checkout.';
