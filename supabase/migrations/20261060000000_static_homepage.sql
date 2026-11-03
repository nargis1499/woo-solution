-- NULL keeps the current storefront. Stable identity survives page slug changes;
-- deletion restores the default without retaining a dangling reference.
alter table public.site_settings
  add column if not exists home_page_id uuid references public.pages(id) on delete set null;
comment on column public.site_settings.home_page_id is
  'Published CMS page rendered at /; NULL uses the built-in storefront. Draft/missing pages fall back at runtime.';
-- Do not add this content-specific foreign key to client_setup_fields: exported
-- client setups intentionally do not contain the source store's page rows.
