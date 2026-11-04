-- =============================================================================
--  Stripe Checkout (hosted Checkout Sessions)
--
--  • Stripe credentials deliberately do NOT live in the publicly readable
--    `site_settings` row. They are stored in a private singleton table with
--    RLS enabled and no anon/authenticated policies. Only the service role
--    (used by server actions, Checkout creation and the webhook) can read it.
--  • Orders keep the Stripe Checkout Session / PaymentIntent references so a
--    signed webhook and the customer's return page can reconcile the same
--    payment idempotently.
--  • `stripe_webhook_events` is the event-id ledger recommended for duplicate
--    webhook deliveries. Fulfilment itself is also idempotent by order/session.
-- =============================================================================

create table if not exists public.stripe_settings (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  publishable_key text,
  secret_key text,
  webhook_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.stripe_settings (id)
values (1)
on conflict (id) do nothing;

drop trigger if exists stripe_settings_set_updated_at on public.stripe_settings;
create trigger stripe_settings_set_updated_at
  before update on public.stripe_settings
  for each row execute function public.set_updated_at();

alter table public.stripe_settings enable row level security;
-- Intentionally no policies: browser/API roles must never read Stripe secrets.
revoke all on table public.stripe_settings from public, anon, authenticated;
grant all on table public.stripe_settings to service_role;

alter table public.orders
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_checkout_status text,
  add column if not exists stripe_payment_status text;

create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists orders_stripe_payment_intent_id_idx
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  checkout_session_id text,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists stripe_webhook_events_set_updated_at on public.stripe_webhook_events;
create trigger stripe_webhook_events_set_updated_at
  before update on public.stripe_webhook_events
  for each row execute function public.set_updated_at();

create index if not exists stripe_webhook_events_order_id_idx
  on public.stripe_webhook_events (order_id)
  where order_id is not null;

alter table public.stripe_webhook_events enable row level security;
-- Webhook bookkeeping is server-only too.
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

comment on table public.stripe_settings is
  'Private singleton Stripe Checkout configuration. Service-role only; never expose through site_settings.';
comment on table public.stripe_webhook_events is
  'Idempotency ledger for signed Stripe webhook/event-destination deliveries. Service-role only.';

notify pgrst, 'reload schema';
