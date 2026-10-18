-- =============================================================================
--  Woo Solution — Tech Catalog Seed (4 Categories, 20 Products with Popular Brands)
--  Run AFTER migrations (including 20261039000000_product_brand.sql).
--
--  Prices are base amounts in micro-dollars (1 USD = 1,000,000::bigint).
-- =============================================================================

-- Ensure the `brand` column exists even if this seed is run standalone in SQL Editor
alter table public.products
  add column if not exists brand text;

alter table public.site_settings
  add column if not exists home_show_category_sections boolean not null default true;

-- Remove legacy non-tech demo products & categories if present
delete from public.products
where slug in (
  'classic-cotton-tee',
  'everyday-hoodie',
  'slim-chino-pants',
  'leather-card-wallet',
  'canvas-tote-bag',
  'minimal-steel-watch',
  'ceramic-pour-over-set',
  'linen-throw-blanket',
  'soy-wax-candle',
  'wireless-earbuds',
  'mechanical-keyboard',
  'usb-c-charging-hub'
);

delete from public.menu_items
where kind = 'category'
  and category_id in (
    select id from public.categories where slug in ('apparel', 'accessories', 'home')
  );

delete from public.categories
where slug in ('apparel', 'accessories', 'home');

insert into public.categories (name, slug, icon, sort_order) values
  ('Electronics',          'electronics',        'headphones', 1),
  ('Laptops',              'laptops',            'laptop',     2),
  ('Mobiles',              'mobiles',            'smartphone', 3),
  ('Gaming & Accessories', 'gaming-accessories', 'gamepad-2',  4)
on conflict (slug) do update set
  name       = excluded.name,
  icon       = excluded.icon,
  sort_order = excluded.sort_order;

-- Demo header menu: add the seeded categories after "Shop"
insert into public.menu_items (location, kind, title, category_id, sort_order)
select 'header', 'category', c.name, c.id,
       (select coalesce(max(sort_order), -1) from public.menu_items where location = 'header') + c.sort_order
from public.categories c
where c.slug in ('electronics', 'laptops', 'mobiles', 'gaming-accessories')
  and not exists (select 1 from public.menu_items m where m.location = 'header' and m.category_id = c.id);

insert into public.products
  (category_id, name, slug, brand, description, price_micros, compare_at_price_micros, image_url, stock, is_featured, created_at)
values
  -- ── SECTION 01: Electronics (6 products) ──────────────────────────────────
  ((select id from public.categories where slug = 'electronics'),
   'Wireless Noise-Canceling Headphones', 'wireless-noise-canceling-headphones', 'SONY',
   'Industry-leading noise cancellation headphone with adaptive sound control and extreme acoustic depth.',
   349 * 1000000::bigint, 399 * 1000000::bigint,
   'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
   45, true, now() - interval '1 minute'),

  ((select id from public.categories where slug = 'electronics'),
   'Smart Watch Pro Edition', 'smart-watch-pro-edition', 'APPLE',
   'Advanced health metrics, fitness tracking, and seamless connectivity on a durable titanium body.',
   429 * 1000000::bigint, 499 * 1000000::bigint,
   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80',
   30, true, now() - interval '2 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'Portable Bluetooth Boom Speaker', 'portable-bluetooth-boom-speaker', 'JBL',
   'Bold sound and punchy bass for indoor listening or outdoor rugged adventures.',
   149 * 1000000::bigint, 179 * 1000000::bigint,
   'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=80',
   60, false, now() - interval '3 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'QuietComfort Ultra Wireless Earbuds', 'quietcomfort-ultra-wireless-earbuds', 'BOSE',
   'Spatial audio earbuds with world-class noise cancellation and custom-tuned acoustic architecture.',
   249 * 1000000::bigint, 299 * 1000000::bigint,
   'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=900&q=80',
   50, false, now() - interval '4 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'Alpha Mirrorless 4K Vlog Camera', 'alpha-mirrorless-4k-vlog-camera', 'SONY',
   'Compact APS-C mirrorless camera with real-time eye autofocus, 4K 60p video, and directional 3-capsule mic.',
   799 * 1000000::bigint, 899 * 1000000::bigint,
   'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80',
   18, false, now() - interval '5 minutes'),

  ((select id from public.categories where slug = 'electronics'),
   'iPad Air M2 11-Inch Wi-Fi', 'ipad-air-m2-11-inch', 'APPLE',
   'Liquid Retina display powered by the Apple M2 chip with Apple Pencil Pro support and all-day battery.',
   549 * 1000000::bigint, 599 * 1000000::bigint,
   'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=900&q=80',
   25, false, now() - interval '6 minutes'),

  -- ── SECTION 02: Laptops (6 products) ──────────────────────────────────────
  ((select id from public.categories where slug = 'laptops'),
   'UltraSlim Pro 14 Laptop', 'ultraslim-pro-14-laptop', 'APPLE',
   'Ultra-thin sleek design engineered for power efficiency, vivid graphics, and all-day battery.',
   1299 * 1000000::bigint, 1449 * 1000000::bigint,
   'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
   20, true, now() - interval '7 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Gaming Beast RTX 4070 Laptop', 'gaming-beast-rtx-4070-laptop', 'ASUS',
   'Uncompromised frame rates and liquid cooling tech designed for competitive AAA gaming.',
   1799 * 1000000::bigint, 1999 * 1000000::bigint,
   'https://images.unsplash.com/photo-1603302576837-37561b2e2302?auto=format&fit=crop&w=900&q=80',
   15, true, now() - interval '8 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Creator Studio Book 16', 'creator-studio-book-16', 'DELL',
   'Tailor-made for video editors, 3D artists, and photographers requiring 100% color accuracy.',
   1999 * 1000000::bigint, 2199 * 1000000::bigint,
   'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
   12, false, now() - interval '9 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'ThinkPad X1 Carbon Gen 12', 'thinkpad-x1-carbon-gen-12', 'LENOVO',
   'Featherlight carbon-fiber business ultrabook with Intel Core Ultra processor and legendary keyboard.',
   1599 * 1000000::bigint, 1799 * 1000000::bigint,
   'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?auto=format&fit=crop&w=900&q=80',
   22, false, now() - interval '10 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Spectre x360 14 2-in-1 OLED', 'spectre-x360-14-oled', 'HP',
   'Convertible 2.8K OLED touchscreen laptop with 360-degree hinge, stylus support, and quad speakers.',
   1399 * 1000000::bigint, 1549 * 1000000::bigint,
   'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=900&q=80',
   16, false, now() - interval '11 minutes'),

  ((select id from public.categories where slug = 'laptops'),
   'Blade 16 Dual-Mode Mini-LED', 'blade-16-dual-mode-mini-led', 'RAZER',
   'CNC-milled aluminum gaming laptop featuring a dual-mode UHD+ 120Hz / FHD+ 240Hz Mini-LED display.',
   2499 * 1000000::bigint, 2799 * 1000000::bigint,
   'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=900&q=80',
   9, false, now() - interval '12 minutes'),

  -- ── SECTION 03: Mobiles (4 products) ──────────────────────────────────────
  ((select id from public.categories where slug = 'mobiles'),
   'Galaxy S25 Ultra 5G 512GB', 'galaxy-s25-ultra-5g', 'SAMSUNG',
   '200MP pro-grade quad camera system, built-in S Pen, and anti-reflective Gorilla Armor titanium frame.',
   1199 * 1000000::bigint, 1349 * 1000000::bigint,
   'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=80',
   35, true, now() - interval '13 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'iPhone 16 Pro Max 256GB', 'iphone-16-pro-max-256gb', 'APPLE',
   'Grade 5 titanium design with 120Hz ProMotion display, A18 Pro chip, and 4K 120fps Dolby Vision.',
   1099 * 1000000::bigint, 1199 * 1000000::bigint,
   'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=900&q=80',
   40, true, now() - interval '14 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'Pixel 9 Pro XL 5G', 'pixel-9-pro-xl-5g', 'GOOGLE',
   'Super Actua LTPO display powered by Google Tensor G4 with pro triple rear camera and Gemini AI.',
   949 * 1000000::bigint, 1099 * 1000000::bigint,
   'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=80',
   28, false, now() - interval '15 minutes'),

  ((select id from public.categories where slug = 'mobiles'),
   'OnePlus 13 5G Snapdragon Elite', 'oneplus-13-5g-snapdragon-elite', 'ONEPLUS',
   'Hasselblad camera for mobile, 100W SuperVOOC ultra-fast charging, and 2K 120Hz ProXDR display.',
   849 * 1000000::bigint, 949 * 1000000::bigint,
   'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
   32, false, now() - interval '16 minutes'),

  -- ── SECTION 04: Gaming & Accessories (4 products) ─────────────────────────
  ((select id from public.categories where slug = 'gaming-accessories'),
   'G Pro X Superlight 2 Wireless Mouse', 'g-pro-x-superlight-2-mouse', 'LOGITECH',
   '60g ultra-lightweight esports mouse with HERO 2 32K sensor and LIGHTFORCE hybrid optical switches.',
   139 * 1000000::bigint, 159 * 1000000::bigint,
   'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80',
   55, false, now() - interval '17 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'BlackWidow V4 Pro Mechanical Keyboard', 'blackwidow-v4-pro-keyboard', 'RAZER',
   'Full-blown battlestation mechanical keyboard with command dial, dedicated macro keys, and Chroma RGB.',
   199 * 1000000::bigint, 229 * 1000000::bigint,
   'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
   26, false, now() - interval '18 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'UltraGear 27" 4K OLED 240Hz Monitor', 'ultragear-27-4k-oled-monitor', 'LG',
   '0.03ms response time OLED gaming monitor with DisplayHDR True Black 400 and NVIDIA G-SYNC.',
   899 * 1000000::bigint, 1049 * 1000000::bigint,
   'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=900&q=80',
   14, false, now() - interval '19 minutes'),

  ((select id from public.categories where slug = 'gaming-accessories'),
   'Prime 250W GaN Desktop Charging Station', 'prime-250w-gan-charging-station', 'ANKER',
   '6-port ultra-fast GaNPrime power station with smart LCD power dial and four USB-C PD 3.1 ports.',
   129 * 1000000::bigint, 159 * 1000000::bigint,
   'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=900&q=80',
   48, false, now() - interval '20 minutes')
on conflict (slug) do update set
  category_id             = excluded.category_id,
  name                    = excluded.name,
  brand                   = excluded.brand,
  description             = excluded.description,
  price_micros            = excluded.price_micros,
  compare_at_price_micros = excluded.compare_at_price_micros,
  image_url               = excluded.image_url,
  stock                   = excluded.stock,
  is_featured             = excluded.is_featured,
  created_at              = excluded.created_at;
