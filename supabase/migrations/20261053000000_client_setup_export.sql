-- Live client bootstrap export, not a backup. Never read business/auth rows.
-- A registry makes NEW configuration fields opt-in rather than accidentally leaking secrets.
create table public.client_setup_fields (
 table_name text not null check (table_name ~ '^[a-z_][a-z0-9_]*$'),
 column_name text not null check (column_name ~ '^[a-z_][a-z0-9_]*$'),
 primary key(table_name,column_name),
 check (table_name in ('site_settings','ai_settings','diagnostic_log_settings'))
);
alter table public.client_setup_fields enable row level security;
revoke all on public.client_setup_fields from public,anon,authenticated;
-- Only database migrations maintain this safety boundary. Dashboard admins cannot widen it.
insert into public.client_setup_fields(table_name,column_name)
select 'site_settings',unnest(array[
 'currency','usd_to_bdt_rate','manage_stock','payment_cod_enabled','shipping_enabled','shipping_rate_micros',
 'theme_light','theme_dark','theme_gradients','theme_sync',
 'home_show_categories','home_show_featured','home_show_filter','home_show_hero',
 'home_show_category_sections','home_category_default_layout','home_category_banner_style'
]) union all select 'ai_settings',unnest(array[
 'provider','primary_model','fallback_model','ollama_mode','ollama_num_ctx','ollama_disable_thinking',
 'token_budget_mode','reasoning_effort','temperature','vision_enabled','brand_tone','default_language'
]) union all select 'diagnostic_log_settings','retention_hours';

create function public.export_client_setup(p_copy_settings boolean default true) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public
set statement_timeout='25s'
as $export$
declare
 out_sql text; r record; a record; g record; stmt text; role_name text;
 config jsonb; filtered jsonb; omitted jsonb := '{}'::jsonb;
 identity_sql text; copied integer := 0; registry_sql text := '';
 view_count integer; emitted_views oid[] := '{}'; candidates integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 -- Fail visibly for unsupported constructs, never return an apparently complete partial dump.
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and (c.relkind in ('p','f','m') or c.relispartition or c.reloftype<>0))
 or exists(select 1 from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
 or exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attgenerated<>'')
 or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('d','r','m') and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e'))
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='c')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind not in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))

 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype join pg_class c on c.oid=t.typrelid where n.nspname='public' and c.relkind='v')
 or exists(select 1 from pg_rewrite rw join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and rw.rulename<>'_RETURN')
 then raise exception 'Schema contains advanced objects this application exporter does not support. Use a reviewed pg_dump --schema-only export instead.'; end if;

 out_sql := '-- Woo Solution: LIVE fresh-client setup (not a backup)' || E'\n-- Generated ' || clock_timestamp()::text || E'\n-- Run once, as postgres, in a NEW Supabase project. Requires PostgreSQL 17+.\n-- No users, business records, files or credentials are copied. Read README-CLIENT-SETUP.md.\nbegin;\nset local check_function_bodies = off;\nset local search_path = public, extensions, pg_catalog;\n';
 out_sql := out_sql || E'do $fresh$ begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=''public'' and c.relkind in (''r'',''p'',''v'',''m'',''S'') and not exists(select 1 from pg_depend d where d.classid=''pg_class''::regclass and d.objid=c.oid and d.deptype=''e'')) then raise exception ''Fresh Supabase project required: public application objects already exist''; end if; end $fresh$;\n';
 -- Supabase owns its auth/storage schemas. Install extension declarations, not their internals.
 for r in select e.extname,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname not in ('plpgsql','pg_stat_statements','supabase_vault') order by e.extname loop
   if r.nspname not in ('pg_catalog','public') then out_sql:=out_sql||format('create schema if not exists %I;',r.nspname)||E'\n'; end if;
   out_sql:=out_sql||format('create extension if not exists %I with schema %I;',r.extname,r.nspname)||E'\n';
 end loop;
 -- Enums precede columns; extension-owned objects are restored by CREATE EXTENSION.
 for r in select t.oid,t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e') order by t.typname loop
   select string_agg(quote_literal(enumlabel),', ' order by enumsortorder) into stmt from pg_enum where enumtypid=r.oid;
   out_sql:=out_sql||format('create type public.%I as enum (%s);',r.typname,stmt)||E'\n';
 end loop;
 -- Empty sequences retain configuration, NEVER their current values.
 for r in select c.oid,c.relname,s.* from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_sequence s on s.seqrelid=c.oid where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('i','e')) order by c.relname loop
   out_sql:=out_sql||format('create sequence public.%I as %s increment by %s minvalue %s maxvalue %s start with %s cache %s %s;',r.relname,format_type(r.seqtypid,null),r.seqincrement,r.seqmin,r.seqmax,r.seqstart,r.seqcache,case when r.seqcycle then 'cycle' else 'no cycle' end)||E'\n';
 end loop;
 for r in select c.oid,c.relname,c.relpersistence,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname loop
   stmt:='';
   for a in select a.*,format_type(a.atttypid,a.atttypmod) as type_sql from pg_attribute a where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped order by a.attnum loop
     identity_sql:='';
     if a.attidentity<>'' then
       select format(' generated %s as identity (sequence name public.%I increment by %s minvalue %s maxvalue %s start with %s cache %s %s)',case when a.attidentity='a' then 'always' else 'by default' end,seq.relname,q.seqincrement,q.seqmin,q.seqmax,q.seqstart,q.seqcache,case when q.seqcycle then 'cycle' else 'no cycle' end)
       into identity_sql from pg_depend d join pg_class seq on seq.oid=d.objid join pg_sequence q on q.seqrelid=seq.oid where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass and d.deptype='i' and d.refobjid=r.oid and d.refobjsubid=a.attnum;
       if identity_sql is null then raise exception 'Missing identity configuration'; end if;
     end if;
     stmt:=stmt||case when stmt='' then '' else E',\n' end||format('  %I %s%s%s%s',a.attname,a.type_sql,case when a.attcollation<>0 and a.attcollation<>(select typcollation from pg_type where oid=a.atttypid) then ' collate '||a.attcollation::regcollation::text else '' end,identity_sql,case when a.attnotnull then ' not null' else '' end);
   end loop;
   out_sql:=out_sql||format(E'create %stable public.%I (\n%s\n);',case when r.relpersistence='u' then 'unlogged ' else '' end,r.relname,stmt)||E'\n';
   if r.reloptions is not null then out_sql:=out_sql||format('alter table public.%I set (%s);',r.relname,array_to_string(r.reloptions,', '))||E'\n'; end if;
 end loop;
 -- Function bodies are checked after restore; their referenced tables now exist.
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by p.proname,p.oid loop
   out_sql:=out_sql||pg_get_functiondef(r.oid)||E';\n';
 end loop;
 -- Defaults and constraints after functions. PK/unique/exclusion must precede foreign keys.
 for r in select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=d.adnum where n.nspname='public' order by c.relname,a.attnum loop
   out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';
 end loop;
 for r in select c.relname,con.conname,pg_get_constraintdef(con.oid,true) as def from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype<>'f' order by c.relname,con.conname loop
   out_sql:=out_sql||format('alter table public.%I add constraint %I %s;',r.relname,r.conname,r.def)||E'\n';
 end loop;
 for r in select pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not exists(select 1 from pg_constraint con where con.conindid=i.indexrelid) order by c.relname,i.indexrelid loop
   out_sql:=out_sql||r.def||E';\n';
 end loop;
 for r in select c.relname,con.conname,pg_get_constraintdef(con.oid,true) as def from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype='f' order by c.relname,con.conname loop
   out_sql:=out_sql||format('alter table public.%I add constraint %I %s;',r.relname,r.conname,r.def)||E'\n';
 end loop;
 for r in select seq.relname as seqname,c.relname,a.attname from pg_depend d join pg_class seq on seq.oid=d.objid and seq.relkind='S' join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=seq.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=d.refobjsubid where d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass and d.deptype='a' and n.nspname='public' loop
   out_sql:=out_sql||format('alter sequence public.%I owned by public.%I.%I;',r.seqname,r.relname,r.attname)||E'\n';
 end loop;
 -- Views topologically ordered; stop rather than silently break a dependency cycle.
 select count(*) into view_count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e');
 while cardinality(emitted_views)<view_count loop
   candidates:=0;
   for r in select c.oid,c.relname,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not c.oid=any(emitted_views) and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') and not exists(select 1 from pg_rewrite rw join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=rw.oid join pg_class dep on dep.oid=d.refobjid join pg_namespace dn on dn.oid=dep.relnamespace where rw.ev_class=c.oid and d.refclassid='pg_class'::regclass and dep.relkind='v' and dn.nspname='public' and dep.oid<>c.oid and not dep.oid=any(emitted_views)) order by c.relname loop
     out_sql:=out_sql||format('create view public.%I%s as %s',r.relname,case when r.reloptions is null then '' else ' with ('||array_to_string(r.reloptions,', ')||')' end,pg_get_viewdef(r.oid,true))||E';\n';
     emitted_views:=array_append(emitted_views,r.oid); candidates:=candidates+1;
   end loop;
   if candidates=0 then raise exception 'Unresolved view dependencies: use pg_dump'; end if;
 end loop;
 -- Application triggers on auth/storage are included, not managed platform triggers.
 for r in select t.oid,t.tgname,t.tgenabled,c.relname,n.nspname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and (n.nspname='public' or (n.nspname in ('auth','storage') and pn.nspname='public')) and not exists(select 1 from pg_depend d where d.classid='pg_trigger'::regclass and d.objid=t.oid and d.deptype='e') order by n.nspname,c.relname,t.tgname loop
   out_sql:=out_sql||format('drop trigger if exists %I on %I.%I;',r.tgname,r.nspname,r.relname)||E'\n'||pg_get_triggerdef(r.oid,true)||E';\n';
   if r.tgenabled<>'O' then out_sql:=out_sql||format('alter table %I.%I %s trigger %I;',r.nspname,r.relname,case r.tgenabled when 'D' then 'disable' when 'R' then 'enable replica' else 'enable always' end,r.tgname)||E'\n'; end if;
 end loop;
 for r in select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
   out_sql:=out_sql||format('alter table public.%I %s row level security;',r.relname,case when r.relrowsecurity then 'enable' else 'disable' end)||E'\n';
   if r.relforcerowsecurity then out_sql:=out_sql||format('alter table public.%I force row level security;',r.relname)||E'\n'; end if;
   if r.relreplident='f' then out_sql:=out_sql||format('alter table public.%I replica identity full;',r.relname)||E'\n';
   elsif r.relreplident='n' then out_sql:=out_sql||format('alter table public.%I replica identity nothing;',r.relname)||E'\n';
   elsif r.relreplident='i' then select ic.relname into stmt from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=(format('public.%I',r.relname))::regclass and i.indisreplident; out_sql:=out_sql||format('alter table public.%I replica identity using index %I;',r.relname,stmt)||E'\n'; end if;
 end loop;
 for r in select p.*,c.relname,n.nspname from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' or (n.nspname='storage' and c.relname in ('objects','buckets')) order by n.nspname,c.relname,p.polname loop
   select string_agg(case when x=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x)) end,', ') into stmt from unnest(r.polroles) x;
   out_sql:=out_sql||format('drop policy if exists %I on %I.%I;',r.polname,r.nspname,r.relname)||E'\n'||format('create policy %I on %I.%I as %s for %s to %s%s%s;',r.polname,r.nspname,r.relname,case when r.polpermissive then 'permissive' else 'restrictive' end,case r.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,stmt,case when r.polqual is null then '' else ' using ('||pg_get_expr(r.polqual,r.polrelid)||')' end,case when r.polwithcheck is null then '' else ' with check ('||pg_get_expr(r.polwithcheck,r.polrelid)||')' end)||E'\n';
 end loop;
 -- Restore public-schema and enum permissions without relying on target defaults.
 out_sql:=out_sql||E'revoke all on schema public from PUBLIC, anon, authenticated, service_role;\n';
 for g in select x.* from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where n.nspname='public' loop
   role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
   out_sql:=out_sql||format('grant %s on schema public to %s%s;',g.privilege_type,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
 end loop;
 for r in select t.* from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e') loop
   out_sql:=out_sql||format('revoke all on type public.%I from PUBLIC, anon, authenticated, service_role;',r.typname)||E'\n';
   for g in select * from aclexplode(coalesce(r.typacl,acldefault('T',r.typowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant %s on type public.%I to %s%s;',g.privilege_type,r.typname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 -- Explicit ACL reconstruction prevents broad fresh-project default grants leaking private tables.
 for r in select c.oid,c.relname,c.relkind,c.relowner,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname loop
   stmt:=case when r.relkind='S' then 'sequence' else 'table' end;
   out_sql:=out_sql||format('revoke all on %s public.%I from PUBLIC, anon, authenticated, service_role;',stmt,r.relname)||E'\n';
   for g in select * from aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 'S'::"char" else 'r'::"char" end,r.relowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant %s on %s public.%I to %s%s;',g.privilege_type,stmt,r.relname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
   for a in select attname,attacl from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped and attacl is not null loop
     for g in select * from aclexplode(a.attacl) loop
       role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
       out_sql:=out_sql||format('grant %s (%I) on table public.%I to %s%s;',g.privilege_type,a.attname,r.relname,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
     end loop;
   end loop;
 end loop;
 for r in select p.*,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
   stmt:=case when r.prokind='p' then 'procedure' else 'function' end;
   out_sql:=out_sql||format('revoke all on %s public.%I(%s) from PUBLIC, anon, authenticated, service_role;',stmt,r.proname,r.args)||E'\n';
   for g in select * from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('grant execute on %s public.%I(%s) to %s%s;',stmt,r.proname,r.args,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 for r in select d.* from pg_default_acl d where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace loop
   stmt:=case r.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' else null end;
   if stmt is null then raise exception 'Unsupported default privilege type'; end if;
   out_sql:=out_sql||format('alter default privileges for role postgres in schema public revoke all on %s from PUBLIC, anon, authenticated, service_role;',stmt)||E'\n';
   for g in select * from aclexplode(r.defaclacl) loop
     role_name:=case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end;
     out_sql:=out_sql||format('alter default privileges for role postgres in schema public grant %s on %s to %s%s;',g.privilege_type,stmt,role_name,case when g.is_grantable then ' with grant option' else '' end)||E'\n';
   end loop;
 end loop;
 -- Preserve bootstrap field registry rows (configuration, never business records).
 for r in select * from public.client_setup_fields order by table_name,column_name loop
   registry_sql:=registry_sql||format('insert into public.client_setup_fields(table_name,column_name) values (%L,%L);',r.table_name,r.column_name)||E'\n';
 end loop;
 out_sql:=out_sql||registry_sql;
 -- Seed singleton defaults, then optionally overlay explicitly safe CURRENT values.
 for r in select unnest(array['site_settings','ai_settings','diagnostic_log_settings']) as name loop
   if to_regclass('public.'||r.name) is null then continue; end if;
   out_sql:=out_sql||format('insert into public.%I(id) values (%s);',r.name,case when r.name='diagnostic_log_settings' then 'true' else '1' end)||E'\n';
   execute format('select to_jsonb(s) from public.%I s limit 1',r.name) into config;
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into filtered from jsonb_each(coalesce(config,'{}')) where p_copy_settings and key in (select column_name from public.client_setup_fields where table_name=r.name);
   select omitted||jsonb_build_object(r.name,coalesce(jsonb_agg(key),'[]'::jsonb)) into omitted from jsonb_each(coalesce(config,'{}')) where key not in (select column_name from public.client_setup_fields where table_name=r.name) and key<>'id';
   select string_agg(format('%I = %L::%s',a.attname,filtered->>a.attname,format_type(a.atttypid,a.atttypmod)),', ' order by a.attnum) into stmt from pg_attribute a where a.attrelid=to_regclass('public.'||r.name) and a.attnum>0 and not a.attisdropped and filtered ? a.attname;
   if stmt is not null then out_sql:=out_sql||format('update public.%I set %s;',r.name,stmt)||E'\n'; select copied+count(*)::integer into copied from jsonb_object_keys(filtered); end if;
 end loop;
 out_sql:=out_sql||E'update public.site_settings set payment_crypto_enabled=false,payment_plisio_enabled=false,seo_indexing=false;\nupdate public.ai_settings set enabled=false,require_confirmation=true;\n';
 -- Realtime memberships, bucket configuration and pg_cron declarations are configuration, not content.
 for r in select b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types from storage.buckets b order by b.id loop
   out_sql:=out_sql||format('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values (%L,%L,%L,%L,%L) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;',r.id,r.name,r.public,r.file_size_limit,r.allowed_mime_types)||E'\n';
 end loop;
 for r in select p.pubname,c.relname from pg_publication_rel pr join pg_publication p on p.oid=pr.prpubid join pg_class c on c.oid=pr.prrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and p.pubname='supabase_realtime' loop
   out_sql:=out_sql||format('alter publication supabase_realtime add table public.%I;',r.relname)||E'\n';
 end loop;
 if exists(select 1 from pg_extension where extname='pg_cron') then
   for r in select jobname,schedule,command,active from cron.job where jobname like 'nemesis-%' order by jobname loop
     if r.command !~* '^\s*select\s+public\.[a-z_][a-z0-9_]*\(\s*\)\s*;?\s*$' then raise exception 'Scheduled job % needs a reviewed configuration export',r.jobname; end if;
     out_sql:=out_sql||format('select cron.schedule(%L,%L,%L);',r.jobname,r.schedule,r.command)||E'\n';
     if not r.active then out_sql:=out_sql||format('select cron.alter_job((select jobid from cron.job where jobname=%L),active:=false);',r.jobname)||E'\n'; end if;
   end loop;
 end if;
 out_sql:=out_sql||E'notify pgrst, ''reload schema'';\ncommit;\n-- Next: configure Auth URLs, create your own admin, deploy the client GitHub repository to Cloudflare Workers.\n';
 return jsonb_build_object('sql',out_sql,'omitted_settings',omitted,'copied_fields',copied,'exported_at',clock_timestamp(),'scope','public schema + app auth/storage integration; no business rows');
end;
$export$;
revoke all on function public.export_client_setup(boolean) from public,anon,authenticated;
grant execute on function public.export_client_setup(boolean) to authenticated;
