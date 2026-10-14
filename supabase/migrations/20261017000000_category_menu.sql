-- =============================================================================
--  Woo Solution – category visibility in the header menu
--  Run after 20261016000000_admin.sql (safe to re-run).
--
--  Adds `categories.show_in_menu`: when true the category is listed in the
--  storefront's main navigation; the category itself (and /shop?category=…)
--  keeps working either way. Toggled from /nemesis/categories.
-- =============================================================================

alter table public.categories
  add column if not exists show_in_menu boolean not null default true;

comment on column public.categories.show_in_menu is
  'Whether the category appears in the storefront header navigation.';
