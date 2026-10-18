-- ════════════════════════════════════════════════════════════════════════════
--  Settings → General: Footer Text
--
--  Adds `footer_text` to `public.site_settings` so the secondary copyright
--  text in the storefront footer ("Built with Next.js, Supabase and shadcn/ui.")
--  can be edited from Settings → General.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.site_settings
  add column if not exists footer_text text default 'Built with Next.js, Supabase and shadcn/ui.';

comment on column public.site_settings.footer_text is 'Footer copyright secondary text shown after "© {year} {store_name}."';
