-- =============================================================================
--  PAGES (admin dashboard → Pages): About us, Contact, Privacy policy, FAQ …
--  Idempotent – safe to run more than once.
--
--  1. pages            one row per page: title, slug, sanitised HTML content,
--                      featured image (Media Library), SEO fields, status,
--                      author, published_at
--     tags / page_tags optional, reusable tags (unique regardless of case)
--     page_media       images used *inside* the content (usage tracking)
--  2. Row level security: everyone can read published pages (and their
--     tags), admins manage everything
--  3. media_usage() also reports pages (featured image / share image / content)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.pages (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 200),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  content            text not null default '',                                  -- sanitised HTML from the editor
  excerpt            text,                                                      -- plain-text summary derived from the content (default meta description)
  featured_image_id  uuid references public.media (id) on delete set null,
  status             text not null default 'draft' check (status in ('draft', 'published')),
  seo_title          text check (char_length(seo_title) <= 120),
  seo_description    text check (char_length(seo_description) <= 320),
  canonical_url      text check (char_length(canonical_url) <= 500),
  robots_index       boolean not null default true,
  robots_follow      boolean not null default true,
  og_title           text check (char_length(og_title) <= 120),
  og_description     text check (char_length(og_description) <= 320),
  og_image_id        uuid references public.media (id) on delete set null,
  author_id          uuid references public.profiles (id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists pages_status_idx    on public.pages (status, published_at desc);
create index if not exists pages_updated_idx   on public.pages (updated_at desc);
create index if not exists pages_title_idx     on public.pages (lower(title));
create index if not exists pages_featured_idx  on public.pages (featured_image_id);
create index if not exists pages_og_image_idx  on public.pages (og_image_id);

drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 50),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz not null default now()
);
create unique index if not exists tags_name_key on public.tags (lower(name));

create table if not exists public.page_tags (
  page_id   uuid not null references public.pages (id) on delete cascade,
  tag_id    uuid not null references public.tags (id) on delete cascade,
  position  integer not null default 0,
  primary key (page_id, tag_id)
);
create index if not exists page_tags_tag_idx on public.page_tags (tag_id);

-- Media Library images referenced from inside the content (<img data-media-id>)
create table if not exists public.page_media (
  page_id   uuid not null references public.pages (id) on delete cascade,
  media_id  uuid not null references public.media (id) on delete cascade,
  primary key (page_id, media_id)
);
create index if not exists page_media_media_idx on public.page_media (media_id);

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.pages      enable row level security;
alter table public.tags       enable row level security;
alter table public.page_tags  enable row level security;
alter table public.page_media enable row level security;

drop policy if exists "Published pages are viewable by everyone" on public.pages;
create policy "Published pages are viewable by everyone"
  on public.pages for select
  using (status = 'published' or public.is_admin());

drop policy if exists "Admins can manage pages" on public.pages;
create policy "Admins can manage pages"
  on public.pages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Tags are viewable by everyone" on public.tags;
create policy "Tags are viewable by everyone"
  on public.tags for select
  using (true);

drop policy if exists "Admins can manage tags" on public.tags;
create policy "Admins can manage tags"
  on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Page tags are viewable by everyone" on public.page_tags;
create policy "Page tags are viewable by everyone"
  on public.page_tags for select
  using (true);  -- the page itself is protected by the pages policy

drop policy if exists "Admins can manage page tags" on public.page_tags;
create policy "Admins can manage page tags"
  on public.page_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage page media" on public.page_media;
create policy "Admins can manage page media"
  on public.page_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. USAGE: products + site settings + pages
--     (product_* columns double as page id / title / slug for the page roles)
-- -----------------------------------------------------------------------------
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql
stable
set search_path = public
as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text
    from public.products p
   where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text
    from public.product_media pm
    join public.products p on p.id = pm.product_id
   where pm.media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text
    from public.site_settings s
   where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text
    from public.site_settings s
   where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text
    from public.pages pg
   where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text
    from public.pages pg
   where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text
    from public.page_media pm
    join public.pages pg on pg.id = pm.page_id
   where pm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;
