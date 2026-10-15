# Woo Solution

A WooCommerce-style storefront built with **Next.js 16** (App Router, Cache Components), **Supabase** (Postgres + Auth) and **shadcn/ui on the React Aria base** (`react-aria-components`, Tailwind v4).

**MVP scope** – customers can browse a product catalog, sign up / sign in, add items to a cart, check out with cash on delivery, and view their order history.

| Area | What's included |
| --- | --- |
| Catalog | Home page with categories & featured products, `/shop` with category filter + search, product detail pages with related products |
| Cart | Guest-friendly cart persisted in `localStorage` (Zustand), quantity controls, stock limits, shipping preview |
| Auth | E-mail + password **and "Continue with Google"** (Supabase Auth, PKCE flow), sign out, protected routes, open-redirect-safe `?next=` handling |
| Checkout | Shipping form → atomic `place_order()` Postgres function (prices re-read from DB, stock locked & decremented, order number generated) |
| Orders | `/orders` history and `/orders/[id]` confirmation page, protected by Row Level Security |
| Security | RLS on every table, `SECURITY DEFINER` checkout RPC only executable by `authenticated`, JWT verified with `getClaims()` |
| Admin | `/nemesis` dashboard for users with `profiles.is_admin = true`: products (with image upload to Supabase Storage), categories, orders, users/roles and site settings – see [Admin dashboard](#admin-dashboard) |
| UI | shadcn/ui components built on **React Aria** (accessible menus, dialogs, selects, tables, sheets, switches …) for both the storefront and the admin dashboard; see [UI toolkit](#ui-toolkit) |
| UX | Dark mode (system / light / dark, remembered), route-change progress bar, page transitions, toast notifications, mobile navigation sheet |

---

## 1. Quick start

### Prerequisites

- Node.js **20.9+** (22 LTS recommended – supabase-js prints a deprecation warning on 20)
- A free [Supabase](https://supabase.com) project

### Install

```bash
git clone https://github.com/nargis1499/woo-solution.git
cd woo-solution
npm install
cp .env.example .env.local
```

### Set up the database

1. Open your Supabase project → **SQL Editor** → *New query*.
2. Run the migrations **in order** – paste each file and execute it:
   1. [`supabase/migrations/20261014000000_init.sql`](supabase/migrations/20261014000000_init.sql) – schema, RLS, `place_order()`
   2. [`supabase/migrations/20261015000000_google_auth.sql`](supabase/migrations/20261015000000_google_auth.sql) – `profiles.avatar_url` + Google-aware profile trigger (safe to run on an existing project)
   3. [`supabase/migrations/20261016000000_admin.sql`](supabase/migrations/20261016000000_admin.sql) – `profiles.is_admin`, admin RLS policies, `site_settings`, the public `product-images` Storage bucket, `admin_stats()` / `admin_delete_user()` (safe to run on an existing project)
   4. [`supabase/migrations/20261017000000_category_menu.sql`](supabase/migrations/20261017000000_category_menu.sql) – `categories.show_in_menu` (header-menu visibility toggle; existing categories stay visible)
   5. [`supabase/migrations/20261018000000_settings_tabs.sql`](supabase/migrations/20261018000000_settings_tabs.sql) – settings tabs: contact links, favicon & SEO columns on `site_settings`, the global `manage_stock` switch (`stock_managed()`, honoured by `place_order()` and the order-status trigger) and the public `site-media` Storage bucket for branding files (safe to run on an existing project)
   6. [`supabase/migrations/20261019000000_media_library.sql`](supabase/migrations/20261019000000_media_library.sql) – **Media Library**: `media`, `media_folders`, `product_media` (galleries), `products.image_media_id`, `media_usage()` / `media_totals()`, RLS and the public `media` Storage bucket (5 MB per file, admin-only writes). Safe to run on an existing project – current product images keep working as plain URLs
3. Paste [`supabase/seed.sql`](supabase/seed.sql) and run it to load the 12 demo products.
4. Make yourself an admin (after signing up once in the app – see [Admin dashboard](#admin-dashboard)):

   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```

> Using the Supabase CLI instead? `supabase link --project-ref <ref> && supabase db push`, then run the seed file with `supabase db query -f supabase/seed.sql` (or paste it in the SQL editor).

### Configure environment variables

Open `.env.local` and fill in the values from **Project Settings → API** (or the *Connect* dialog):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # legacy "anon" key also works
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_STORE_NAME=Woo Solution
NEXT_PUBLIC_CURRENCY=USD
# optional – enables the "Suggest with AI" alt-text button in the Media Library (server-side only)
# OPENAI_API_KEY=sk-...
# OPENAI_ALT_TEXT_MODEL=gpt-4o-mini
```

### Auth settings (Supabase dashboard → Authentication)

- **URL Configuration → Site URL**: `http://localhost:3000` (your production URL later)
- **URL Configuration → Redirect URLs**: add `http://localhost:3000/auth/callback`
- **Providers → Email → Confirm email**: turn **off** for frictionless local testing, or leave it on – the app handles both (users get a confirmation e-mail that lands on `/auth/callback`).

### Google sign-in (optional, ~5 minutes)

The "Continue with Google" button uses Supabase's built-in Google provider – no extra packages or environment variables. Until the provider is enabled, clicking the button shows *"Google sign-in failed: provider is not enabled"*; e-mail/password keeps working regardless.

1. **Supabase** → **Authentication → Sign In / Providers → Google**. Copy the **Callback URL (for OAuth)** shown there – it looks like
   `https://<project-ref>.supabase.co/auth/v1/callback`. Keep this tab open.
2. **Google Cloud Console** → <https://console.cloud.google.com/auth/overview> (Google Auth Platform). Pick or create a project and, if asked, finish the *Branding* / audience setup (External, add your e-mail as a test user while the app is in *Testing*).
3. **Clients → Create client** → *Application type: Web application*:
   - **Authorized JavaScript origins**: `http://localhost:3000` (add your production URL later)
   - **Authorized redirect URIs**: the Supabase callback URL from step 1
   - Create → copy the **Client ID** and **Client secret**.
4. Back in Supabase: toggle **Enable Sign in with Google** on, paste **Client ID** and **Client Secret**, save.
5. Make sure `http://localhost:3000/auth/callback` (and your production `/auth/callback`) is in **Authentication → URL Configuration → Redirect URLs** – you already added it above.
6. Run the `20261015000000_google_auth.sql` migration if you haven't (see *Set up the database*).

That's it – `npm run dev`, open <http://localhost:3000/login> and click **Continue with Google**.

How it works: `signInWithGoogle` (server action) asks Supabase for the Google consent URL → Google → `https://<ref>.supabase.co/auth/v1/callback` → back to the app's `/auth/callback?code=…&next=…` → `exchangeCodeForSession` sets the session cookie → redirect to `next` (so a guest who hits *Checkout* ends up back on `/checkout`, cart intact). The profile trigger copies Google's `name` → `profiles.full_name` and `picture` → `profiles.avatar_url`, and the header shows the avatar. Supabase links a Google login to an existing account with the same **verified** e-mail automatically.

> **Going to production?** Publish the Google app (Auth Platform → *Audience* → *Publish*) so people other than your test users can sign in, and add your production domain to the JavaScript origins. For a branded consent screen (your domain instead of `<ref>.supabase.co`) set up a Supabase *custom domain*.

### Run

```bash
npm run dev
```

Visit <http://localhost:3000>, add something to the cart, create an account and place an order. 🎉

### Admin dashboard

The back office lives at **`/nemesis`** (deliberately not linked anywhere public). Access is decided by one flag in the database – `public.profiles.is_admin` – and enforced in three layers:

1. `src/proxy.ts` redirects signed-out visitors to `/login?next=/nemesis`.
2. `src/app/nemesis/layout.tsx` calls `requireAdmin()`; a signed-in user without the flag gets the normal **404** page (the route doesn't reveal itself).
3. Every Server Action re-checks the flag **and** Postgres RLS only lets admins write to `products`, `categories`, `orders`, other users' `profiles`, `site_settings` and the `product-images` bucket. Promoting someone through the UI or the API without being an admin is rejected by a trigger.

**Bootstrapping the first admin** – nobody is an admin by default. Sign up in the app (e-mail or Google), then run in the SQL Editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

Reload the page and an **Admin** link appears in the header. From then on you can grant/revoke admin for other users in *Users*.

| Section | What you can do |
| --- | --- |
| Dashboard | Revenue / order / product / customer stats, orders by status, recent orders, low-stock list |
| Products | Create, edit, delete; search & filter; draft/active, featured, stock, sale price; **main image** + **gallery** picked from the Media Library (upload a new file or select an existing one – see [Media](#media)), or paste any image URL |
| Categories | Create, rename, reorder, delete (products become uncategorised); **Show in header menu** toggle decides which categories appear in the storefront navigation |
| Orders | Filter by status, view items & shipping address, change order / payment status (cancelling restocks the items, re-opening reserves them again), delete |
| Users | View customers with their order history, edit name/phone, grant or revoke **Administrator**, delete a user (their orders are kept). You can't demote or delete yourself |
| Media | The Media Library – see [Media](#media) below: uploads, grid / list browsing, search, filters, folders, trash, bulk actions, image optimisation / WebP conversion / editing, alt text, usage tracking and the reusable **media picker** |
| Settings | Three tabs – see [Settings](#settings) below: **General** (site title, tagline, support e-mail, WhatsApp, Telegram, favicon), **SEO** (search-engine visibility, site URL, title / meta description, share image, verification codes, X handle) and **WooCommerce** (global stock management switch) |

The **Products, Orders and Users** lists are paginated: `?page=` + a **per-page** selector (10 / 20 / 50 / 100, top right of the table, `?per=`, remembered per admin in a cookie). Changing the size keeps the first visible row on screen, a new filter starts on page 1, a page that no longer exists redirects to the last one, and view / edit / delete bring you back to the exact page, size and filter you came from.

**Bulk delete** – the same three lists have a checkbox column. Tick rows (the header checkbox selects the whole page, Shift+click selects a range, Space toggles the focused row) and a floating **N selected → Delete** bar appears; confirming removes them in one go and reports the result as a toast. Rows are links as well: click anywhere on a row to open it while nothing is selected – once something is ticked, clicking a row toggles it instead. Your own account can be opened but never selected, and `deleteUsers` additionally skips the caller's id on the server.

Every action reports back through a toast notification (bottom-right corner of the dashboard, [sonner](https://sonner.emilkowal.ski/)) – successes in green, failures in red – while validation errors stay next to the fields they belong to.

#### Settings

`/nemesis/settings` is organised in tabs (shadcn/React Aria `Tabs`; every tab is its own form and Server Action, unsaved edits survive switching, `?tab=seo` deep-links). Everything saved there is live immediately – the `site_settings` row is cached with a tag that each save invalidates.

| Tab | Options | Where it shows up |
| --- | --- | --- |
| General | Site title, tagline, support e-mail, **WhatsApp** number, **Telegram** username, **favicon** upload | `<title>` template, header, hero, footer (e-mail / `wa.me` / `t.me` links), `<link rel="icon">`, Organization JSON-LD. Favicons go to the separate **`site-media`** bucket (`branding/…`), never into `product-images`; replacing or removing one deletes the old file |
| SEO | **Search engine visibility** switch, site URL, home page title, meta description (with a 160-character guide), social share image (Open Graph 1200 × 630, uploaded to `site-media`), Google Search Console + Bing Webmaster verification codes (paste the token or the whole `<meta>` tag), X / Twitter handle | `<meta name="robots">` (`noindex, nofollow` when visibility is off), `/robots.txt` (disallows everything when off, otherwise `/nemesis`, `/cart`, `/checkout`, `/orders`, `/login`, `/signup`, `/auth` + the sitemap line), `/sitemap.xml` (home, shop, categories, active products – tag-invalidated on every admin write), canonical URLs, Open Graph / Twitter cards, `google-site-verification` / `msvalidate.01` meta tags, Organization + WebSite (SearchAction) JSON-LD. Cart, checkout, orders, login and signup are always `noindex` |
| WooCommerce | **Manage stock** switch (on by default) | Off = every product is unlimited (digital goods): no "sold out" / "only N left" badges, quantities are only capped by `MAX_QTY_PER_LINE`, `place_order()` neither checks nor decrements `products.stock`, cancelling / re-opening orders doesn't move stock, the admin stock column / field and the low-stock dashboard card disappear (stored quantities are kept untouched). On = the previous strict behaviour |

Without a site URL the app falls back to `NEXT_PUBLIC_SITE_URL` for absolute URLs (sitemap, canonicals, JSON-LD).

Branding images (favicon, share image) are served through `next/image`; `*.supabase.co` and a few stock-photo hosts are allow-listed in `src/lib/image-hosts.ts` – add your own CDN there. Plain-`http` URLs (e.g. a local Supabase on `127.0.0.1`) are rendered unoptimised.

#### Media

`/nemesis/media` (sidebar → **Media**, just above Settings) is a WordPress-style media library backed by the public `media` Storage bucket and the `public.media` table.

| Area | What it does |
| --- | --- |
| Upload | Drag & drop or browse, several files at once, **any file type up to 5 MB** (active content such as `.html`, `.js`, `.exe`, `.php` … is refused for safety – the list lives in `src/lib/media/shared.ts`). Per-file and overall progress bars, clear size / type errors, duplicate detection (same bytes already in the library → *Skip* or *Upload anyway*). Files go browser → Storage directly, then the server verifies the stored bytes, records dimensions and generates **thumbnail / medium / large** WebP renditions (never upscaled) |
| Browse | Grid ⇄ list toggle, name / type / size / dimensions / upload date, storage totals (library + trash), **Show per page** 12 / 24 / 48 / 96 (`?per=`, remembered in a cookie), pagination, loading and empty states. Everything lives in the URL (`?q&kind&folder&from&to&size&sort&page&view&trash`) so views are shareable |
| Find | Search by name; filter by type (Image / Video / Document / Other), **date range** (calendar), **file size** (under 100 KB / 100 KB – 1 MB / over 1 MB) and folder; sort by date, name, size or type |
| Per file | Click a tile → detail dialog with a large preview (or a file-type icon), type, size, dimensions, upload date, full URL, **alt text** (+ *Suggest with AI* when `OPENAI_API_KEY` is set), folder, usage, and the actions **Copy URL · Download · Rename · Replace file · Edit image · Optimize · Move to trash**. Renaming only changes the display name and *Replace file* keeps the same path – the URL never changes |
| Bulk | Select All / Clear Selection; download as a zip; move to a folder; optimise / convert; move to trash. From the **Trash** view: restore, delete permanently (also removes the renditions from Storage) or **Empty trash** – permanent deletion is only possible from the trash |
| Images | **Optimize** (re-encode without visible quality loss, adjustable quality slider), convert PNG / JPEG → **WebP** (or AVIF), single or bulk with a progress bar and a before/after size summary. **Edit**: crop (free or fixed ratios), rotate, flip – *Apply* overwrites the file in place, *Save as a copy* creates `<name>-edited.<ext>` |
| Organise | Flat **folders** (create / rename / delete – files are kept, just unfiled), usage tracking (*Used in 1 product* on the tile, product links in the detail dialog), soft delete with a trash |
| Picker | The **media picker** (`src/components/admin/media/media-picker.tsx`) is the same library as a dialog: on the product form *Add image* / *Add images* offer **Media Library** (browse, search, filter, grid / list, single or multiple selection) or **Upload new**. Products store the **media reference** (`products.image_media_id`, `product_media` for the gallery) – not just a URL – so renaming, replacing, trashing or converting a file is reflected everywhere it is used. The storefront product page shows the main image plus a switchable gallery with the alt text |

Technical notes: uploads are validated twice (browser + server, including the real stored size and type), Storage policies allow writes to the `media` bucket for admins only, renditions and conversions use [sharp](https://sharp.pixelplumbing.com/), zips are built with [fflate](https://github.com/101arrowz/fflate), and every long-running action (uploads, bulk optimise, zip downloads) reports progress and finishes with a toast.

---

## 2. Project structure

```
woo-solution/
├── supabase/
│   ├── migrations/20261014000000_init.sql   # schema, RLS, triggers, place_order() RPC
│   ├── migrations/20261015000000_google_auth.sql
│   ├── migrations/20261016000000_admin.sql  # is_admin flag, admin RLS, site_settings, Storage bucket
│   ├── migrations/20261017000000_category_menu.sql  # categories.show_in_menu
│   ├── migrations/20261018000000_settings_tabs.sql  # contact/SEO/stock settings, stock_managed(), site-media bucket
│   ├── migrations/20261019000000_media_library.sql  # media library tables, galleries, media bucket
│   └── seed.sql                             # demo categories + products
├── src/
│   ├── proxy.ts                             # refreshes the Supabase session, guards /checkout & /orders
│   ├── app/
│   │   ├── layout.tsx                       # root: fonts, theme + React Aria router providers, toaster, SEO metadata
│   │   ├── robots.ts, sitemap.ts            # /robots.txt + /sitemap.xml from Settings → SEO
│   │   ├── (store)/                         # storefront route group (header / footer shell in layout.tsx)
│   │   │   ├── page.tsx                     # home: hero, categories, featured products
│   │   │   ├── shop/page.tsx                # catalog (?category=slug&q=search)
│   │   │   ├── products/[slug]/             # product detail + purchase panel
│   │   │   ├── cart/page.tsx                # cart (client-side)
│   │   │   ├── checkout/{page.tsx,actions.ts}  # checkout form + placeOrder server action
│   │   │   ├── orders/                      # order history + order detail / confirmation
│   │   │   ├── login/, signup/              # auth pages
│   │   │   └── error.tsx, not-found.tsx
│   │   ├── auth/actions.ts                  # signIn / signUp / signOut / signInWithGoogle server actions
│   │   ├── auth/callback/route.ts           # e-mail confirmation + OAuth (PKCE code exchange)
│   │   ├── nemesis/                         # admin: layout (sidebar shell + requireAdmin), actions.ts,
│   │   │                                    #   dashboard, products/, categories/, orders/, users/, settings/
│   │   ├── template.tsx                     # page-enter animation
│   │   └── globals.css                      # Tailwind v4 + shadcn theme tokens (light / dark)
│   ├── components/
│   │   ├── ui/                              # shadcn/ui (React Aria base) – generated, edit freely
│   │   ├── admin/                           # dashboard: app-sidebar, admin-header, forms, list toolbar …
│   │   ├── data-grid.tsx, page-breadcrumbs.tsx  # client wrappers around the React Aria Table / Breadcrumbs
│   │   └── header.tsx, mobile-nav.tsx, user-menu.tsx, cart-*.tsx, product-*.tsx, checkout-form.tsx …
│   ├── hooks/use-mobile.ts
│   └── lib/
│       ├── admin/{auth,data,storage,list-params,pagination,constants}.ts
│       ├── site-settings.ts, menu.ts        # cached store settings / header categories (tag-invalidated)
│       ├── seo.ts                           # metadata, robots/sitemap entries, JSON-LD built from the SEO tab
│       ├── image-hosts.ts                   # next/image allow-list
│       ├── supabase/{server,proxy}.ts       # Supabase clients (server components / actions, proxy)
│       ├── auth.ts                          # getCurrentUser() – verified via getClaims()
│       ├── data/{products,orders}.ts        # data-access layer
│       ├── cart-store.ts                    # Zustand cart (persisted)
│       ├── config.ts                        # store name, currency, shipping rules
│       ├── format.ts, types.ts, utils.ts
├── components.json                          # shadcn/ui config (base: aria, style: vega)
└── .github/workflows/ci.yml                 # lint + type-check + build on every push

Google sign-in lives in `src/app/auth/actions.ts` (`signInWithGoogle`), `src/components/google-button.tsx` and `src/app/auth/callback/route.ts`.
```

### Database schema

```
auth.users ──1:1──▶ profiles (auto-created by trigger)
categories ──1:N──▶ products
auth.users ──1:N──▶ orders ──1:N──▶ order_items (price & name snapshotted at purchase)
media_folders ──1:N──▶ media ◀──N:M──▶ products (product_media = gallery, products.image_media_id = main image)
```

- Prices are stored as **integer cents** (`price_cents`) – no floating-point rounding.
- `place_order(p_items jsonb, p_shipping jsonb)` runs the whole checkout in one transaction:
  validates auth + input → inserts the order → locks each product row (`FOR UPDATE`) → checks & decrements stock → snapshots items → computes shipping (`calculate_shipping`) → returns the order id. Any failure rolls everything back and surfaces a friendly message (e.g. *"Only 2 left in stock for "Everyday Hoodie"."*).
- Row Level Security: products/categories are readable by everyone (active products only); orders and order items are readable **only by their owner**; nobody can insert/update orders directly from the client.

### UI toolkit

The UI is built from [shadcn/ui](https://ui.shadcn.com) components generated with the **React Aria** base
(`npx shadcn@latest init --base aria`). The primitives live in `src/components/ui/` and are plain project
files – change them like any other code. To add more components run, e.g.

```bash
npx shadcn@latest add tabs
```

Conventions worth knowing:

- Everything interactive (buttons, links styled as buttons, menus, dialogs, selects, switches, tables) is a
  React Aria component, so keyboard navigation, focus management and ARIA semantics come for free.
  Prefer `onPress` over `onClick` and `isDisabled` / `isPending` over the DOM attributes.
- React Aria collections (`Table`, `Breadcrumbs`) must be rendered by client components from plain data –
  `src/components/data-grid.tsx` and `page-breadcrumbs.tsx` do that for server pages.
- Theme tokens (colours, radius) are CSS variables in `src/app/globals.css`; dark mode flips the `.dark` class
  via `next-themes`. Toasts use `sonner` (`<Toaster />` is mounted once in the root layout).

### Rendering model

The project uses Next.js 16's **Cache Components** (`cacheComponents: true`). Every page ships a static shell instantly; anything that reads the session or the database lives behind a `<Suspense>` boundary and streams in. `src/lib/supabase/server.ts` calls `connection()` so Supabase work always happens at request time.

---

## 3. Configuration

| What | Where |
| --- | --- |
| Store name / currency | `.env.local` → `NEXT_PUBLIC_STORE_NAME`, `NEXT_PUBLIC_CURRENCY` (also update `orders.currency` default in the migration if you change currency) |
| Shipping rules | `src/lib/config.ts` **and** `calculate_shipping()` in the migration (keep in sync) |
| Max quantity per line | `src/lib/config.ts` → `MAX_QTY_PER_LINE` |
| Store name / tagline / contact links / favicon | `/nemesis/settings` → **General** (stored in `site_settings`; `NEXT_PUBLIC_STORE_NAME` is only the fallback) |
| Search engine visibility, meta description, share image, verification codes, sitemap | `/nemesis/settings` → **SEO** (`/robots.txt` and `/sitemap.xml` are generated from it) |
| Stock management on/off | `/nemesis/settings` → **WooCommerce** (global; `public.stock_managed()` in SQL) |
| Products / categories | `/nemesis/products` and `/nemesis/categories` (or the Supabase Table Editor). *Draft* products are hidden from the shop, *Featured* ones show on the home page |
| Product images & files | `/nemesis/media` (Media Library, Storage bucket `media`) – pick them on the product form, or paste any public URL; allow-listed hosts for remote images live in `src/lib/image-hosts.ts` |
| AI alt text | Set `OPENAI_API_KEY` (and optionally `OPENAI_ALT_TEXT_MODEL`) in `.env.local` – a *Suggest with AI* button appears next to the alt text in the media detail dialog |
| Orders | `/nemesis/orders` – change `status` (`pending` → `processing` → `completed` / `cancelled`) and `payment_status` |
| Admins | `/nemesis/users` → *Administrator* checkbox, or `update public.profiles set is_admin = true where email = '…'` |
| Admin URL | Rename the `src/app/nemesis` folder, then search-and-replace `/nemesis` in `src/` (links, `ADMIN_PATH` in `src/lib/admin/auth.ts`, `PROTECTED_PREFIXES` in `src/lib/supabase/proxy.ts`) |

---

## 4. Scripts

```bash
npm run dev     # start dev server
npm run build   # production build (also validates Cache Components rules)
npm run start   # serve the production build
npm run lint    # eslint
```

---

## 5. Deploying

Works out of the box on [Vercel](https://vercel.com): import the repo, add the environment variables from `.env.example`, and set `NEXT_PUBLIC_SITE_URL` to your deployed URL. Then add `https://<your-domain>/auth/callback` to Supabase's *Redirect URLs* and `https://<your-domain>` to the Google OAuth client's *Authorized JavaScript origins*.

---

## 6. Roadmap (post-MVP)

- [ ] **Online payments** – Stripe Checkout (or SSLCommerz / bKash for Bangladesh) and a webhook that marks `payment_status = 'paid'`
- [x] **Admin dashboard** – products, categories, orders, users, settings (`/nemesis`)
- [x] **Settings tabs** – General / SEO / WooCommerce (contact links, favicon, robots + sitemap, global stock switch)
- [x] **Product images in Supabase Storage** with an upload UI
- [x] **Media Library** – uploads, folders, trash, optimisation / WebP, image editor, alt text, usage tracking, reusable picker
- [ ] Admin extras – CSV export, audit log, per-section roles
- [ ] **Server-side cart** (`cart_items` table) synced across devices, merged on login
- [ ] **Coupons & discounts**, tax rules, multiple shipping methods
- [ ] **Transactional e-mails** (order confirmation) via Resend / Supabase Edge Functions
- [ ] **Account page** – edit profile, saved addresses, password reset
- [ ] More social providers (GitHub, Facebook, Apple) – same pattern as Google, one `provider` string away
- [ ] Product variants (size / colour), reviews, wishlists

---

## License

MIT
