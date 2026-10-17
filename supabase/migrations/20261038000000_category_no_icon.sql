-- -----------------------------------------------------------------------------
--  CATEGORY "NO ICON"
--
--  A category that has a picture normally shows an icon badge on top of it
--  (the default shopping bag when the admin never picked one). `icon_disabled`
--  is the admin's "Remove icon" answer: the tile uses the picture alone.
--  Only meaningful when the category has an image – without one the tile still
--  needs an icon, so the shopping bag stays.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon_disabled boolean not null default false;

comment on column public.categories.icon_disabled is 'True when the admin removed the icon of a category that has a picture – the tile shows the image alone. Ignored without an image.';
