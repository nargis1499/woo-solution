-- =============================================================================
--  Woo Solution – home page sections (UI → Home page)
--  Run this in the Supabase SQL Editor *after* 20261023000000_menus.sql.
--  Idempotent: safe to run more than once.
--
--  Four columns on site_settings decide which sections the storefront home
--  page renders (and the heading of the filtered-products section):
--    home_show_categories  "Shop by category" tiles              (default on)
--    home_show_featured    "Featured products" grid              (default on)
--    home_show_filter      shop-style category filter + products (default off)
--    home_filter_title     heading above that filter, free text  (optional)
--  Defaults reproduce the home page exactly as it was before this migration.
-- =============================================================================

alter table public.site_settings
  add column if not exists home_show_categories boolean not null default true,
  add column if not exists home_show_featured   boolean not null default true,
  add column if not exists home_show_filter     boolean not null default false,
  add column if not exists home_filter_title    text;

comment on column public.site_settings.home_show_categories is 'Home page: render the "Shop by category" tiles';
comment on column public.site_settings.home_show_featured   is 'Home page: render the "Featured products" grid';
comment on column public.site_settings.home_show_filter     is 'Home page: render the shop-style category filter with its product grid';
comment on column public.site_settings.home_filter_title    is 'Heading above the filtered-products section (null = no heading)';

-- PostgREST: pick up the new columns right away
notify pgrst, 'reload schema';
