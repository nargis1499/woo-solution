-- =============================================================================
--  MENUS (admin dashboard → UI → Menu): storefront header and footer navigation
--  Idempotent – safe to run more than once.
--
--  1. menu_items   one row per link, per location (header / footer): a page,
--                  a category or a custom URL, each with its own display title,
--                  "open in a new tab" flag and position
--  2. RLS          everyone reads, admins manage
--  3. Data         the header menu starts as "Shop" + the categories that were
--                  flagged "Show in header menu"; the footer keeps the links it
--                  used to show (Shop, Cart, My orders). The old
--                  categories.show_in_menu column is dropped – menus are now
--                  managed only under UI → Menu.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.menu_items (
  id               uuid primary key default gen_random_uuid(),
  location         text not null check (location in ('header', 'footer')),
  kind             text not null check (kind in ('page', 'category', 'custom')),
  title            text not null check (char_length(title) between 1 and 80),   -- display text (editable, independent of the page / category name)
  page_id          uuid references public.pages (id) on delete cascade,         -- kind = 'page'
  category_id      uuid references public.categories (id) on delete cascade,    -- kind = 'category'
  url              text check (char_length(url) <= 500),                        -- kind = 'custom': /path, https://…, mailto:, tel:
  open_in_new_tab  boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint menu_items_target check (
    (kind = 'page'     and page_id is not null     and category_id is null and url is null) or
    (kind = 'category' and category_id is not null and page_id is null     and url is null) or
    (kind = 'custom'   and url is not null         and page_id is null     and category_id is null)
  )
);
create index if not exists menu_items_location_idx on public.menu_items (location, sort_order);
create index if not exists menu_items_page_idx     on public.menu_items (page_id);
create index if not exists menu_items_category_idx on public.menu_items (category_id);

comment on table public.menu_items is 'Storefront navigation (header / footer), managed under UI → Menu in the dashboard.';

drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.menu_items enable row level security;

drop policy if exists "Menu items are viewable by everyone" on public.menu_items;
create policy "Menu items are viewable by everyone"
  on public.menu_items for select
  using (true);

drop policy if exists "Admins can manage menu items" on public.menu_items;
create policy "Admins can manage menu items"
  on public.menu_items for all
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. DATA – carry the current navigation over, then retire show_in_menu
-- -----------------------------------------------------------------------------
do $$
begin
  -- First run on a project: the links the storefront rendered until now.
  if not exists (select 1 from public.menu_items) then
    insert into public.menu_items (location, kind, title, url, sort_order) values
      ('header', 'custom', 'Shop',      '/shop',   0),
      ('footer', 'custom', 'Shop',      '/shop',   0),
      ('footer', 'custom', 'Cart',      '/cart',   1),
      ('footer', 'custom', 'My orders', '/orders', 2);
  end if;

  -- Categories that were shown in the header keep their place (after "Shop", in their sort order).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'categories' and column_name = 'show_in_menu'
  ) then
    insert into public.menu_items (location, kind, title, category_id, sort_order)
    select 'header', 'category', c.name, c.id,
           (select coalesce(max(sort_order), -1) from public.menu_items where location = 'header')
             + row_number() over (order by c.sort_order, c.name)
    from public.categories c
    where c.show_in_menu
      and not exists (select 1 from public.menu_items m where m.location = 'header' and m.category_id = c.id);

    alter table public.categories drop column show_in_menu;
  end if;
end $$;
