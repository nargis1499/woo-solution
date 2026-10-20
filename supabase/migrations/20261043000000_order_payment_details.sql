-- =============================================================================
--  Migration: Order Crypto Payment Details
--  Adds optional crypto payment columns to `public.orders` so Admin can inspect
--  the selected protocol, network, deposit address, and customer Transaction ID (TXID).
-- =============================================================================

alter table public.orders
  add column if not exists payment_protocol text,
  add column if not exists payment_network  text,
  add column if not exists payment_address  text,
  add column if not exists payment_tx_id    text;

comment on column public.orders.payment_protocol is 'Selected crypto wallet protocol name/code (e.g. Tether USDT (USDT))';
comment on column public.orders.payment_network  is 'Selected blockchain network (e.g. TRON TRC20, Bitcoin Mainnet)';
comment on column public.orders.payment_address  is 'Store deposit address shown to customer at checkout';
comment on column public.orders.payment_tx_id    is 'Customer-submitted Transaction ID / Hash (TXID) for Admin verification';
