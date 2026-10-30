-- -----------------------------------------------------------------------------
-- 32. Nemesis AI Settings & Provider Key Vault (Admin-Only)
--     Stores AI provider configuration, model routing, token-budget mode, brand
--     voice instructions, and per-provider API keys for the /nemesis AI Agent.
--     Locked strictly behind `public.is_admin()` RLS so API keys are never
--     exposed to `anon` or regular storefront customers.
-- -----------------------------------------------------------------------------

create table if not exists public.ai_settings (
  id                      integer primary key default 1 check (id = 1),
  enabled                 boolean not null default false,
  provider                text not null default 'groq',
  primary_model           text not null default 'openai/gpt-oss-120b',
  fallback_model          text default 'openai/gpt-oss-20b',
  custom_base_url         text,
  ollama_mode             text not null default 'browser'
                          check (ollama_mode in ('browser', 'tunnel')),
  ollama_base_url         text not null default 'http://localhost:11434',
  ollama_num_ctx          integer not null default 4096
                          check (ollama_num_ctx >= 2048 and ollama_num_ctx <= 131072),
  ollama_disable_thinking boolean not null default true,
  token_budget_mode       text not null default 'economy'
                          check (token_budget_mode in ('economy', 'standard', 'high')),
  reasoning_effort        text not null default 'low'
                          check (reasoning_effort in ('low', 'medium', 'high')),
  temperature             numeric(3, 2) not null default 0.20
                          check (temperature >= 0 and temperature <= 2),
  vision_enabled          boolean not null default false,
  require_confirmation    boolean not null default true,
  brand_tone              text not null default 'modern',
  default_language        text not null default 'English',
  system_instructions     text,
  api_keys                jsonb not null default '{}'::jsonb,
  updated_at              timestamptz not null default now()
);

alter table public.ai_settings enable row level security;

drop policy if exists "ai_settings_admin_all" on public.ai_settings;
create policy "ai_settings_admin_all"
  on public.ai_settings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.ai_settings (id)
values (1)
on conflict (id) do nothing;
