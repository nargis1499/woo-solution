-- =============================================================================
--  Woo Solution – one Storage bucket for everything
-- -----------------------------------------------------------------------------
--  The Media Library ("media" bucket, migration 20261019…) now also holds the
--  branding files (favicon, social share image). This migration
--
--   1. links site_settings to media rows (favicon_media_id, seo_og_image_media_id)
--   2. teaches media_usage() about those two roles ("Used as the site favicon")
--   3. lets admins see / delete the two legacy buckets through the Storage API
--      so the in-app importer (/nemesis/media → "Legacy files") can move the old
--      files into the library and remove the buckets afterwards
--   4. removes the legacy buckets right away when they are already empty
--
--  Safe to run on an existing project (idempotent). Files that are still in
--  product-images / site-media keep working until you import them.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. SETTINGS → MEDIA LINKS (the URL columns stay as a denormalised copy)
-- -----------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists favicon_media_id      uuid references public.media (id) on delete set null,
  add column if not exists seo_og_image_media_id uuid references public.media (id) on delete set null;

-- -----------------------------------------------------------------------------
--  2. USAGE: products (main image / gallery) + site settings (favicon / share image)
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
   where s.seo_og_image_media_id = any (p_ids);
$$;
grant execute on function public.media_usage(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
--  3./4. LEGACY BUCKETS (guarded – also runs on plain Postgres without storage)
-- -----------------------------------------------------------------------------
do $$
declare
  legacy text[] := array['product-images', 'site-media'];
  b text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  -- Admins may look at and delete *only* the two legacy buckets (storage-js
  -- getBucket() / deleteBucket() go through RLS on storage.buckets).
  begin
    execute 'drop policy if exists "Admins can see legacy media buckets" on storage.buckets';
    execute $sql$
      create policy "Admins can see legacy media buckets"
        on storage.buckets for select to authenticated
        using (id in ('product-images', 'site-media') and public.is_admin())
    $sql$;
    execute 'drop policy if exists "Admins can delete legacy media buckets" on storage.buckets';
    execute $sql$
      create policy "Admins can delete legacy media buckets"
        on storage.buckets for delete to authenticated
        using (id in ('product-images', 'site-media') and public.is_admin())
    $sql$;
  exception when others then
    raise notice 'storage.buckets policies skipped: %', sqlerrm;
  end;

  -- Buckets that are already empty disappear now; the rest after the import.
  foreach b in array legacy loop
    begin
      if not exists (select 1 from storage.objects o where o.bucket_id = b) then
        delete from storage.buckets where id = b;
      end if;
    exception when others then
      raise notice 'bucket % left in place: %', b, sqlerrm;
    end;
  end loop;

  -- The per-bucket object policies are only needed while a legacy bucket exists.
  if not exists (select 1 from storage.buckets where id = 'product-images') then
    execute 'drop policy if exists "Product images are publicly readable" on storage.objects';
    execute 'drop policy if exists "Admins can upload product images" on storage.objects';
    execute 'drop policy if exists "Admins can update product images" on storage.objects';
    execute 'drop policy if exists "Admins can delete product images" on storage.objects';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-media') then
    execute 'drop policy if exists "Site media are publicly readable" on storage.objects';
    execute 'drop policy if exists "Admins can upload site media" on storage.objects';
    execute 'drop policy if exists "Admins can update site media" on storage.objects';
    execute 'drop policy if exists "Admins can delete site media" on storage.objects';
  end if;
end
$$;
