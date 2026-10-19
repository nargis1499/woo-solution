-- =============================================================================
--  HEADER DROPDOWN MENUS (admin dashboard → UI → Menu → Header menu)
--  Idempotent – safe to run more than once.
-- =============================================================================

alter table public.menu_items
  add column if not exists parent_id uuid references public.menu_items (id) on delete set null;

create index if not exists menu_items_parent_idx on public.menu_items (parent_id);

comment on column public.menu_items.parent_id is 'Optional parent menu item id (header menu dropdown items). Null for top-level items and footer menu items.';
