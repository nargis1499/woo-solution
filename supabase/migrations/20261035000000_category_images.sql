-- -----------------------------------------------------------------------------
--  CATEGORY IMAGES
--
--  A category can carry a picture that the storefront shows on its
--  "Shop by category" tiles (the grid falls back to a gradient icon otherwise).
--  The file itself lives in the Media Library; `image_url` mirrors its public
--  URL so public pages never have to join `media`. A plain external URL is
--  allowed too — `image_media_id` simply stays null then.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists image_url text,
  add column if not exists image_media_id uuid references public.media (id) on delete set null;

create index if not exists categories_image_media_id_idx on public.categories (image_media_id);

comment on column public.categories.image_url is 'Public URL of the tile image (Media Library file or an external URL).';
comment on column public.categories.image_media_id is 'Media Library file behind image_url; null for external URLs.';
