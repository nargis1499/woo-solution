-- =============================================================================
--  MEDIA LIBRARY (admin dashboard → Media)
--  Idempotent – safe to run more than once.
--
--  1. media_folders / media / product_media tables (+ products.image_media_id)
--  2. Row level security: admins manage everything, the storefront can read
--     files that are not in the trash (product galleries)
--  3. media_usage() – where a file is used; media_totals() – storage used
--  4. Storage bucket "media": public read, admins write, 5 MB per file,
--     any file type (the app blocks executable / HTML uploads itself)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.media_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);
create unique index if not exists media_folders_name_key on public.media_folders (lower(name));

create table if not exists public.media (
  id             uuid primary key default gen_random_uuid(),
  folder_id      uuid references public.media_folders (id) on delete set null,
  name           text not null check (char_length(name) between 1 and 200),   -- display / download name (rename never changes the URL)
  path           text not null unique,                                        -- object key inside the "media" bucket
  mime_type      text not null,
  kind           text not null check (kind in ('image', 'video', 'document', 'other')),
  size           bigint not null check (size >= 0),
  width          integer,
  height         integer,
  alt            text,
  hash           text,                                                        -- sha-256 of the file (duplicate detection)
  variants       jsonb not null default '{}'::jsonb,                          -- generated sizes: {thumbnail|medium|large: {path,width,height,size}}
  variants_size  bigint not null default 0,
  uploaded_by    uuid references auth.users (id) on delete set null,
  deleted_at     timestamptz,                                                 -- set = in the trash
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists media_library_idx on public.media (deleted_at, created_at desc);
create index if not exists media_hash_idx    on public.media (hash) where deleted_at is null;
create index if not exists media_folder_idx  on public.media (folder_id);
create index if not exists media_kind_idx    on public.media (kind);
create index if not exists media_name_idx    on public.media (lower(name));

drop trigger if exists media_set_updated_at on public.media;
create trigger media_set_updated_at
  before update on public.media
  for each row execute function public.set_updated_at();

-- products reference the library (image_url stays as the denormalised copy the storefront renders)
alter table public.products add column if not exists image_media_id uuid references public.media (id) on delete set null;
create index if not exists products_image_media_idx on public.products (image_media_id);

create table if not exists public.product_media (
  product_id  uuid not null references public.products (id) on delete cascade,
  media_id    uuid not null references public.media (id) on delete cascade,
  position    integer not null default 0,
  primary key (product_id, media_id)
);
create index if not exists product_media_media_idx on public.product_media (media_id);

-- -----------------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.media_folders enable row level security;
alter table public.media          enable row level security;
alter table public.product_media  enable row level security;

drop policy if exists "Admins can manage media folders" on public.media_folders;
create policy "Admins can manage media folders"
  on public.media_folders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Media are viewable by everyone" on public.media;
create policy "Media are viewable by everyone"
  on public.media for select
  using (deleted_at is null or public.is_admin());

drop policy if exists "Admins can manage media" on public.media;
create policy "Admins can manage media"
  on public.media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Product galleries are viewable by everyone" on public.product_media;
create policy "Product galleries are viewable by everyone"
  on public.product_media for select
  using (true);

drop policy if exists "Admins can manage product galleries" on public.product_media;
create policy "Admins can manage product galleries"
  on public.product_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
--  3. HELPERS
-- -----------------------------------------------------------------------------
-- Where is a file used? One row per (file, product, role). Runs with the
-- caller's rights, so RLS on products applies (admins see everything).
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
   where pm.media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- Storage used by the library and by the trash (originals + generated sizes).
create or replace function public.media_totals()
returns table (library_count bigint, library_bytes bigint, trash_count bigint, trash_bytes bigint)
language sql
stable
set search_path = public
as $$
  select count(*) filter (where deleted_at is null),
         coalesce(sum(size + variants_size) filter (where deleted_at is null), 0)::bigint,
         count(*) filter (where deleted_at is not null),
         coalesce(sum(size + variants_size) filter (where deleted_at is not null), 0)::bigint
    from public.media;
$$;
grant execute on function public.media_totals() to authenticated;

-- -----------------------------------------------------------------------------
--  4. STORAGE: "media" bucket (public read, admins write, 5 MB, any type).
--     Guarded so the file also runs on plain Postgres without the storage schema.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 5242880, null)
      on conflict (id) do update
        set public             = excluded.public,
            file_size_limit    = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $sql$;

    execute 'drop policy if exists "Media files are publicly readable" on storage.objects';
    execute $sql$
      create policy "Media files are publicly readable"
        on storage.objects for select
        using (bucket_id = 'media')
    $sql$;

    execute 'drop policy if exists "Admins can upload media files" on storage.objects';
    execute $sql$
      create policy "Admins can upload media files"
        on storage.objects for insert to authenticated
        with check (bucket_id = 'media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can update media files" on storage.objects';
    execute $sql$
      create policy "Admins can update media files"
        on storage.objects for update to authenticated
        using (bucket_id = 'media' and public.is_admin())
        with check (bucket_id = 'media' and public.is_admin())
    $sql$;

    execute 'drop policy if exists "Admins can delete media files" on storage.objects';
    execute $sql$
      create policy "Admins can delete media files"
        on storage.objects for delete to authenticated
        using (bucket_id = 'media' and public.is_admin())
    $sql$;
  end if;
end
$$;
