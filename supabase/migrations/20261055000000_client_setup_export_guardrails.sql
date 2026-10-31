-- Reject dependencies outside this bootstrap's deliberately supported scope.
create function public.assert_client_setup_scope() returns void
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
begin
 if exists (
   select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p','v','m','S','f') and c.relowner='postgres'::regrole
   and n.nspname !~ '^pg_' and n.nspname not in ('public','information_schema','auth','storage','realtime','extensions','vault','graphql','graphql_public','supabase_functions','supabase_migrations','cron','net','pgbouncer')
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S') and c.relowner<>'postgres'::regrole
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proowner<>'postgres'::regrole
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_collation c join pg_namespace n on n.oid=c.collnamespace where n.nspname='public'
   and not exists(select 1 from pg_depend d where d.classid='pg_collation'::regclass and d.objid=c.oid and d.deptype='e')
 ) or exists (
   select 1 from pg_publication p left join pg_publication_rel pr on pr.prpubid=p.oid where p.pubname='supabase_realtime' and (p.puballtables or pr.prqual is not null or pr.prattrs is not null)
 ) or exists (
   select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('site_settings','ai_settings','diagnostic_log_settings') and a.attnum>0 and not a.attisdropped and a.attnotnull and a.attname<>'id' and a.attidentity=''
   and not exists(select 1 from pg_attrdef d where d.adrelid=c.oid and d.adnum=a.attnum)
 ) then raise exception 'Application schemas, ownership, collations, publication filters or required settings defaults need a reviewed bootstrap'; end if;
end;
$$;
revoke all on function public.assert_client_setup_scope() from public,anon,authenticated;

alter function public.export_client_setup(boolean) set search_path=pg_catalog,public,pg_temp;
-- Extend the body without duplicating a large SQL generator. Preserve its ACL.
do $guard$
declare definition text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'perform public.assert_client_setup_scope();')=0 then
   if strpos(definition,' -- Fail visibly for unsupported constructs')=0 then raise exception 'Unexpected export function definition'; end if;
   execute replace(definition,' -- Fail visibly for unsupported constructs',E' perform public.assert_client_setup_scope();\n -- Fail visibly for unsupported constructs');
 end if;
end;
$guard$;
-- Accidental registration of obviously sensitive/reference fields is disallowed.
alter table public.client_setup_fields add constraint client_setup_no_sensitive_fields
 check (column_name !~* '(password|secret|api_keys?|access_token|refresh_token|wallet|address|media_id|^id$|url$)');
