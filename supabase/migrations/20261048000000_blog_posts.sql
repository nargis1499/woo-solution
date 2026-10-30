-- =============================================================================
-- BLOG POSTS — separate editorial posts with the same block content + SEO model
-- as CMS pages. Tags are shared; relations and content-media tracking are not.
-- =============================================================================

create table if not exists public.blog_posts (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 200),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  content            text not null default '',
  excerpt            text,
  featured_image_id  uuid references public.media (id) on delete set null,
  featured_image_url text check (char_length(featured_image_url) <= 2000),
  status             text not null default 'draft' check (status in ('draft', 'published')),
  seo_title          text check (char_length(seo_title) <= 120),
  seo_description    text check (char_length(seo_description) <= 320),
  canonical_url      text check (char_length(canonical_url) <= 500),
  robots_index       boolean not null default true,
  robots_follow      boolean not null default true,
  og_title           text check (char_length(og_title) <= 120),
  og_description     text check (char_length(og_description) <= 320),
  og_image_id        uuid references public.media (id) on delete set null,
  og_image_url       text check (char_length(og_image_url) <= 2000),
  author_id          uuid references public.profiles (id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists blog_posts_status_idx on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_updated_idx on public.blog_posts (updated_at desc);
create index if not exists blog_posts_title_idx on public.blog_posts (lower(title));
create index if not exists blog_posts_featured_idx on public.blog_posts (featured_image_id);
create index if not exists blog_posts_og_image_idx on public.blog_posts (og_image_id);

drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at before update on public.blog_posts
  for each row execute function public.set_updated_at();

create table if not exists public.blog_post_tags (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  position integer not null default 0,
  primary key (post_id, tag_id)
);
create index if not exists blog_post_tags_tag_idx on public.blog_post_tags (tag_id);

create table if not exists public.blog_post_media (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  primary key (post_id, media_id)
);
create index if not exists blog_post_media_media_idx on public.blog_post_media (media_id);

alter table public.blog_posts enable row level security;
alter table public.blog_post_tags enable row level security;
alter table public.blog_post_media enable row level security;

drop policy if exists "Published blog posts are viewable by everyone" on public.blog_posts;
create policy "Published blog posts are viewable by everyone" on public.blog_posts
  for select using (status = 'published' or public.is_admin());
drop policy if exists "Admins can manage blog posts" on public.blog_posts;
create policy "Admins can manage blog posts" on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Blog post tags are viewable by everyone" on public.blog_post_tags;
create policy "Blog post tags are viewable by everyone" on public.blog_post_tags
  for select using (true);
drop policy if exists "Admins can manage blog post tags" on public.blog_post_tags;
create policy "Admins can manage blog post tags" on public.blog_post_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can manage blog post media" on public.blog_post_media;
create policy "Admins can manage blog post media" on public.blog_post_media
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Preserve existing product, site-setting, page, and variation usage tracking;
-- add featured/share/content references for blog posts.
create or replace function public.media_usage(p_ids uuid[])
returns table (media_id uuid, product_id uuid, product_name text, product_slug text, role text)
language sql stable set search_path = public as $$
  select p.image_media_id, p.id, p.name, p.slug, 'image'::text from public.products p where p.image_media_id = any (p_ids)
  union all
  select pm.media_id, p.id, p.name, p.slug, 'gallery'::text from public.product_media pm join public.products p on p.id = pm.product_id where pm.media_id = any (p_ids)
  union all
  select v.image_media_id, p.id, p.name, p.slug, 'variation'::text from public.product_variations v join public.products p on p.id = v.product_id where v.image_media_id = any (p_ids)
  union all
  select s.favicon_media_id, null::uuid, null::text, null::text, 'favicon'::text from public.site_settings s where s.favicon_media_id = any (p_ids)
  union all
  select s.seo_og_image_media_id, null::uuid, null::text, null::text, 'share_image'::text from public.site_settings s where s.seo_og_image_media_id = any (p_ids)
  union all
  select pg.featured_image_id, pg.id, pg.title, pg.slug, 'page_image'::text from public.pages pg where pg.featured_image_id = any (p_ids)
  union all
  select pg.og_image_id, pg.id, pg.title, pg.slug, 'page_share_image'::text from public.pages pg where pg.og_image_id = any (p_ids)
  union all
  select pm.media_id, pg.id, pg.title, pg.slug, 'page_content'::text from public.page_media pm join public.pages pg on pg.id = pm.page_id where pm.media_id = any (p_ids)
  union all
  select bp.featured_image_id, bp.id, bp.title, bp.slug, 'post_image'::text from public.blog_posts bp where bp.featured_image_id = any (p_ids)
  union all
  select bp.og_image_id, bp.id, bp.title, bp.slug, 'post_share_image'::text from public.blog_posts bp where bp.og_image_id = any (p_ids)
  union all
  select bpm.media_id, bp.id, bp.title, bp.slug, 'post_content'::text from public.blog_post_media bpm join public.blog_posts bp on bp.id = bpm.post_id where bpm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- Make the new blog discoverable in the storefront navigation, without
-- duplicating links if this migration is re-applied.
insert into public.menu_items (location, kind, title, url, sort_order)
select location, 'custom', 'Blog', '/blog', coalesce((select max(sort_order) + 1 from public.menu_items m where m.location = links.location), 0)
from (values ('header'::text), ('footer'::text)) as links(location)
where not exists (select 1 from public.menu_items m where m.location = links.location and m.url = '/blog');
