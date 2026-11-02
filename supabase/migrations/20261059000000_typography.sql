-- Reuse the singleton settings row; NULL/legacy configurations use app defaults.
-- Existing theme, currency and customer data are untouched.
alter table public.site_settings add column if not exists typography jsonb;
alter table public.site_settings add constraint site_settings_typography_valid check (
 typography is null or (typography=jsonb_build_object('store',jsonb_build_object('title',typography#>>'{store,title}','body',typography#>>'{store,body}','button',typography#>>'{store,button}'),'admin',jsonb_build_object('title',typography#>>'{admin,title}','body',typography#>>'{admin,body}','button',typography#>>'{admin,button}'))
 and jsonb_path_query_array(typography,'$.*.*') <@ '["Inter", "Poppins", "Roboto", "DM Sans", "Montserrat", "Plus Jakarta Sans", "Open Sans", "Lato", "Playfair Display", "Manrope", "Outfit", "Nunito Sans", "Lora", "Source Sans 3", "Work Sans", "Rubik", "Sora", "Space Grotesk", "Oswald", "Merriweather", "Geist", "IBM Plex Sans", "Public Sans"]'::jsonb)
);
comment on column public.site_settings.typography is 'Independent store/admin title, body and button font names; whitelisted self-hosted families. NULL uses application defaults.';

-- Atomic partial-scope merge: saving Store never overwrites a concurrent Admin save.
-- SECURITY INVOKER retains existing admin-only UPDATE RLS on site_settings.
create function public.save_typography(p jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp
set statement_timeout='10s' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or p='{}'::jsonb then raise exception 'Invalid typography changes'; end if;
 if exists(select 1 from jsonb_object_keys(p) x(key) where key not in ('store','admin')) then raise exception 'Unknown typography scope'; end if;
 update public.site_settings set typography=coalesce(typography,'{"store": {"title": "Plus Jakarta Sans", "body": "Inter", "button": "Inter"}, "admin": {"title": "Inter", "body": "Inter", "button": "Inter"}}'::jsonb)||p where id=1 returning typography into result;
 if not found then raise exception 'Settings record is missing'; end if;
 return result;
end $$;
revoke all on function public.save_typography(jsonb) from public,anon;
grant execute on function public.save_typography(jsonb) to authenticated;

-- Opt this non-secret configuration into the existing client bootstrap export.
do $$ begin
 if to_regclass('public.client_setup_fields') is not null then
   insert into public.client_setup_fields(table_name,column_name) values('site_settings','typography') on conflict do nothing;
 end if;
end $$;
