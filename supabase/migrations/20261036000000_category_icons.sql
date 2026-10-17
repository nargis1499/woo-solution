-- -----------------------------------------------------------------------------
--  CATEGORY ICONS
--
--  The icon a category shows on the "Shop by category" tiles when it has no
--  picture. The value is an id from src/lib/category-icons.ts (22 Lucide icons);
--  null keeps the automatic 1 → 2 → 3 rotation.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon text;

comment on column public.categories.icon is 'Icon id picked in the admin (see src/lib/category-icons.ts); null = automatic rotation.';
