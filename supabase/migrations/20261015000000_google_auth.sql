-- =============================================================================
--  Woo Solution — Google sign-in support
--  Run this AFTER the initial migration (Supabase SQL Editor or `supabase db push`).
--
--  OAuth users arrive with different metadata keys than e-mail sign-ups
--  (Google sends `name`, `avatar_url`, `picture` instead of `full_name`), so the
--  profile trigger now understands both, and profiles gain an avatar column.
-- =============================================================================

alter table public.profiles
  add column if not exists avatar_url text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      ''
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do update
    set full_name  = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

-- The trigger itself (`on_auth_user_created`) already exists from the initial
-- migration and automatically picks up the new function body.
