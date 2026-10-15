-- =============================================================================
--  PAGES – external image URLs (admin dashboard → Pages → "Use a URL")
--  Idempotent – safe to run more than once.
--
--  The featured image and the social share image of a page can either be a
--  Media Library file (featured_image_id / og_image_id) or any public image
--  URL (featured_image_url / og_image_url) – the same choice the product form
--  offers. The app keeps exactly one of the two per image.
-- =============================================================================
alter table public.pages
  add column if not exists featured_image_url text
    check (featured_image_url is null or (length(featured_image_url) <= 2000 and featured_image_url ~* '^https?://')),
  add column if not exists og_image_url text
    check (og_image_url is null or (length(og_image_url) <= 2000 and og_image_url ~* '^https?://'));

comment on column public.pages.featured_image_url is 'External featured image (used when featured_image_id is null)';
comment on column public.pages.og_image_url       is 'External social share image (used when og_image_id is null)';

notify pgrst, 'reload schema';
