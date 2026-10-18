-- Migration: dynamic Home page Hero section settings (UI → Home page)
alter table public.site_settings
  add column if not exists home_show_hero boolean not null default true,
  add column if not exists home_hero_badge text default 'New season',
  add column if not exists home_hero_title text,
  add column if not exists home_hero_subtitle text,
  add column if not exists home_hero_primary_cta_text text default 'Shop now',
  add column if not exists home_hero_primary_cta_href text default '/shop',
  add column if not exists home_hero_secondary_cta_text text default 'Explore electronics',
  add column if not exists home_hero_secondary_cta_href text default '/shop?category=electronics';
