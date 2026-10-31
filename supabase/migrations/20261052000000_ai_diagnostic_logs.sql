-- Private, disposable AI diagnostics. Operational audits are deliberately separate.
create extension if not exists pg_cron;

create table public.diagnostic_log_settings (
 id boolean primary key default true check (id),
 retention_hours integer not null default 72 check (retention_hours in (1,3,6,24,72)),
 last_cleanup_at timestamptz,
 last_cleanup_deleted integer not null default 0
);
insert into public.diagnostic_log_settings(id) values(true);
alter table public.diagnostic_log_settings enable row level security;
revoke all on public.diagnostic_log_settings from public, anon, authenticated;
grant select on public.diagnostic_log_settings to authenticated;
grant update(retention_hours) on public.diagnostic_log_settings to authenticated;
create policy "Admins read diagnostic settings" on public.diagnostic_log_settings for select to authenticated using(public.is_admin());
create policy "Admins change retention" on public.diagnostic_log_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());

create table public.ai_diagnostic_logs (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid default auth.uid() references auth.users(id) on delete set null,
 trace_id uuid not null,
 category text not null default 'ai' check(category = 'ai'),
 source text not null check(source in ('server','worker','browser')),
 provider text not null check(length(provider) <= 60),
 model text not null check(length(model) <= 200),
 status text not null default 'pending' check(status in ('pending','success','error')),
 http_status integer,
 duration_ms integer,
 input_tokens bigint,
 output_tokens bigint,
 request_payload jsonb not null check(octet_length(request_payload::text) <= 300000),
 response_payload jsonb check(octet_length(response_payload::text) <= 300000)
);
create index ai_diagnostic_logs_created_idx on public.ai_diagnostic_logs(created_at desc,id desc);
create index ai_diagnostic_logs_trace_idx on public.ai_diagnostic_logs(trace_id,created_at);
alter table public.ai_diagnostic_logs enable row level security;
revoke all on public.ai_diagnostic_logs from public, anon, authenticated;
grant select,delete on public.ai_diagnostic_logs to authenticated;
grant insert(trace_id,source,provider,model,request_payload) on public.ai_diagnostic_logs to authenticated;
grant update(status,http_status,duration_ms,input_tokens,output_tokens,response_payload) on public.ai_diagnostic_logs to authenticated;
create policy "Admins read AI diagnostics" on public.ai_diagnostic_logs for select to authenticated using(public.is_admin());
create policy "Admins delete AI diagnostics" on public.ai_diagnostic_logs for delete to authenticated using(public.is_admin());
create policy "Admins insert own AI diagnostics" on public.ai_diagnostic_logs for insert to authenticated with check(public.is_admin() and actor_id=auth.uid());
create policy "Admins finish own AI diagnostics" on public.ai_diagnostic_logs for update to authenticated using(public.is_admin() and actor_id=auth.uid()) with check(public.is_admin() and actor_id=auth.uid());

-- No authenticated execution: only the postgres-owned pg_cron job runs this function.
create function public.cleanup_ai_diagnostic_logs() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutoff timestamptz; n integer; removed integer := 0;
begin
 if not pg_try_advisory_xact_lock(782164291) then return; end if;
 select clock_timestamp() - make_interval(hours => retention_hours) into cutoff from public.diagnostic_log_settings where id;
 if cutoff is null then raise exception 'Missing log retention settings'; end if;
 for batch in 1..10 loop
   with expired as (
     select id from public.ai_diagnostic_logs where created_at < cutoff
     order by created_at,id limit 500 for update skip locked
   ) delete from public.ai_diagnostic_logs l using expired e where l.id=e.id;
   get diagnostics n = row_count;
   removed := removed+n;
   exit when n < 500;
 end loop;
 update public.diagnostic_log_settings set last_cleanup_at=clock_timestamp(),last_cleanup_deleted=removed where id;
end;
$$;
revoke all on function public.cleanup_ai_diagnostic_logs() from public,anon,authenticated;
select cron.schedule('nemesis-ai-log-retention','*/5 * * * *','select public.cleanup_ai_diagnostic_logs()');
