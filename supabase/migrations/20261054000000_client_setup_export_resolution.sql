-- Catalog aliases (notably `a`) also appear as PL/pgSQL record names. Resolve
-- qualified catalog columns as columns; outer records still resolve when no
-- matching SQL alias exists. Keep the full export definition in the prior migration.
do $fix$
declare definition text;
begin
 select pg_get_functiondef('public.export_client_setup(boolean)'::regprocedure) into definition;
 if strpos(definition,'#variable_conflict use_column')=0 then
   if strpos(definition,E'\ndeclare\n out_sql')=0 then
     raise exception 'Unexpected export function definition; inspect before updating';
   end if;
   execute replace(definition,E'\ndeclare\n out_sql',E'\n#variable_conflict use_column\ndeclare\n out_sql');
 end if;
end;
$fix$;
