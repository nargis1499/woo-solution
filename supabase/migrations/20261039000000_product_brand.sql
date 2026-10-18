-- Migration: add `brand` & `features` columns to `products`, and homepage category showcase columns to `site_settings`
alter table public.products
  add column if not exists brand text,
  add column if not exists features text;

alter table public.site_settings
  add column if not exists home_show_category_sections boolean not null default true,
  add column if not exists home_category_default_layout text not null default 'grid',
  add column if not exists home_category_banner_style text not null default 'soft',
  add column if not exists home_category_sections jsonb not null default '[]'::jsonb;
