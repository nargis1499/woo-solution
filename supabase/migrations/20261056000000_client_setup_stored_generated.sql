-- PostgreSQL 17: preserve stored generated-column position and expressions.
-- Typed NULL stubs let tables/row types exist before user functions are restored;
-- SET EXPRESSION then installs the real formula before defaults/constraints/seeds.
-- No existing application columns, expressions or rows are changed here.
do $patch$
declare
 definition text;
 old_part text;
 new_part text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'-- Stored generated placeholders preserve column order.')>0 then return; end if;

 old_part := $old$where n.nspname='public' and a.attgenerated<>''$old$;
 new_part := $new$where n.nspname='public' and a.attgenerated not in ('','s')$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export generated-column guard'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$     identity_sql:='';
     if a.attidentity<>'' then$old$;
 new_part := $new$     identity_sql:='';
     -- Stored generated placeholders preserve column order.
     if a.attgenerated='s' then
       identity_sql:=format(' generated always as (null::%s) stored',a.type_sql);
     end if;
     if a.attidentity<>'' then$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export column builder'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef$old$;
 new_part := $new$select c.relname,a.attname,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as expr from pg_attrdef$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export default query'; end if;
 definition:=replace(definition,old_part,new_part);

 old_part := $old$   out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';$old$;
 new_part := $new$   if r.attgenerated='s' then
     out_sql:=out_sql||format('alter table public.%I alter column %I set expression as (%s);',r.relname,r.attname,r.expr)||E'\n';
   else
     out_sql:=out_sql||format('alter table public.%I alter column %I set default %s;',r.relname,r.attname,r.expr)||E'\n';
   end if;$new$;
 if strpos(definition,old_part)=0 then raise exception 'Unexpected export default builder'; end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end;
$patch$;
notify pgrst, 'reload schema';
