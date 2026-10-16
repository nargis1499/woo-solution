-- =============================================================================
--  Woo Solution — demo catalog
--  Run AFTER the migrations. Safe to re-run (upserts by slug).
--
--  Prices are base amounts in micro-dollars (1 USD = 1,000,000, the unit every money
--  column uses – see src/lib/money.ts), so they are written as `<US dollars> * 1000000`.
--  They are displayed as dollars or taka according to Settings → WooCommerce → Currency.
-- =============================================================================

insert into public.categories (name, slug, sort_order) values
  ('Apparel',     'apparel',     1),
  ('Accessories', 'accessories', 2),
  ('Home',        'home',        3),
  ('Electronics', 'electronics', 4)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

-- Demo header menu: the seeded categories after "Shop" (menus are managed under UI → Menu).
insert into public.menu_items (location, kind, title, category_id, sort_order)
select 'header', 'category', c.name, c.id,
       (select coalesce(max(sort_order), -1) from public.menu_items where location = 'header') + c.sort_order
from public.categories c
where c.slug in ('apparel', 'accessories', 'home', 'electronics')
  and not exists (select 1 from public.menu_items m where m.location = 'header' and m.category_id = c.id);

insert into public.products
  (category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, stock, is_featured)
values
  ((select id from public.categories where slug = 'apparel'),
   'Classic Cotton Tee', 'classic-cotton-tee',
   'A soft, breathable 100% organic cotton t-shirt with a relaxed fit. Pre-shrunk and made to last.',
   19.99 * 1000000, 24.99 * 1000000, 'https://picsum.photos/seed/classic-cotton-tee/800/800', 50, true),

  ((select id from public.categories where slug = 'apparel'),
   'Everyday Hoodie', 'everyday-hoodie',
   'Mid-weight fleece hoodie with a brushed interior, kangaroo pocket and ribbed cuffs.',
   49.99 * 1000000, null, 'https://picsum.photos/seed/everyday-hoodie/800/800', 30, true),

  ((select id from public.categories where slug = 'apparel'),
   'Slim Chino Pants', 'slim-chino-pants',
   'Stretch-cotton chinos in a modern slim cut. Available in a flattering mid-rise.',
   54.99 * 1000000, 69.99 * 1000000, 'https://picsum.photos/seed/slim-chino-pants/800/800', 25, false),

  ((select id from public.categories where slug = 'accessories'),
   'Leather Card Wallet', 'leather-card-wallet',
   'Full-grain leather wallet with four card slots and a centre pocket for folded notes.',
   29.99 * 1000000, null, 'https://picsum.photos/seed/leather-card-wallet/800/800', 40, true),

  ((select id from public.categories where slug = 'accessories'),
   'Canvas Tote Bag', 'canvas-tote-bag',
   'Heavy-duty 16oz canvas tote with reinforced handles. Perfect for groceries or the beach.',
   18.99 * 1000000, null, 'https://picsum.photos/seed/canvas-tote-bag/800/800', 60, false),

  ((select id from public.categories where slug = 'accessories'),
   'Minimal Steel Watch', 'minimal-steel-watch',
   'Brushed stainless steel case, sapphire glass and a Japanese quartz movement. 5 ATM water resistant.',
   129 * 1000000, 159 * 1000000, 'https://picsum.photos/seed/minimal-steel-watch/800/800', 12, true),

  ((select id from public.categories where slug = 'home'),
   'Ceramic Pour-Over Set', 'ceramic-pour-over-set',
   'Hand-glazed ceramic dripper and carafe for a cleaner, brighter cup of coffee.',
   38.99 * 1000000, null, 'https://picsum.photos/seed/ceramic-pour-over-set/800/800', 20, false),

  ((select id from public.categories where slug = 'home'),
   'Linen Throw Blanket', 'linen-throw-blanket',
   'Stone-washed European linen throw. Gets softer with every wash.',
   74.99 * 1000000, 89.99 * 1000000, 'https://picsum.photos/seed/linen-throw-blanket/800/800', 15, true),

  ((select id from public.categories where slug = 'home'),
   'Soy Wax Candle', 'soy-wax-candle',
   'Hand-poured soy candle with notes of cedar, bergamot and amber. 45-hour burn time.',
   24 * 1000000, null, 'https://picsum.photos/seed/soy-wax-candle/800/800', 80, false),

  ((select id from public.categories where slug = 'electronics'),
   'Wireless Earbuds', 'wireless-earbuds',
   'Active noise cancelling earbuds with 30 hours of total battery life and wireless charging.',
   89.99 * 1000000, 119.99 * 1000000, 'https://picsum.photos/seed/wireless-earbuds/800/800', 35, true),

  ((select id from public.categories where slug = 'electronics'),
   'Mechanical Keyboard', 'mechanical-keyboard',
   'Compact 75% layout with hot-swappable switches, PBT keycaps and south-facing RGB.',
   109 * 1000000, null, 'https://picsum.photos/seed/mechanical-keyboard/800/800', 18, false),

  ((select id from public.categories where slug = 'electronics'),
   'USB-C Charging Hub', 'usb-c-charging-hub',
   '100W GaN charger with two USB-C and one USB-A port. Charges a laptop, phone and earbuds at once.',
   45.99 * 1000000, null, 'https://picsum.photos/seed/usb-c-charging-hub/800/800', 0, false)
on conflict (slug) do update set
  category_id            = excluded.category_id,
  name                   = excluded.name,
  description            = excluded.description,
  price_micros            = excluded.price_micros,
  compare_at_price_micros = excluded.compare_at_price_micros,
  image_url              = excluded.image_url,
  stock                  = excluded.stock,
  is_featured            = excluded.is_featured;
