-- -----------------------------------------------------------------------------
--  CATEGORY ICON COLOUR
--
--  The fill behind a category's icon on the "Shop by category" tiles. A plain
--  `#rrggbb` value picked in the admin; null means the theme's primary colour.
-- -----------------------------------------------------------------------------

alter table public.categories
  add column if not exists icon_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_icon_color_check'
  ) then
    alter table public.categories
      add constraint categories_icon_color_check
      check (icon_color is null or icon_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end
$$;

comment on column public.categories.icon_color is 'Icon fill (#rrggbb) picked in the admin; null = the theme primary colour.';
