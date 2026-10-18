-- Migration: add `brand` column to `products` and `home_show_category_sections` to `site_settings`
alter table public.products
  add column if not exists brand text;

alter table public.site_settings
  add column if not exists home_show_category_sections boolean not null default true;
