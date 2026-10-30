# Woo Solution

A WooCommerce-style storefront built with **Next.js 16** (App Router, Cache Components), **Supabase** (Postgres + Auth) and **shadcn/ui on the React Aria base** (`react-aria-components`, Tailwind v4).

**MVP scope** – customers can browse a product catalog, sign up / sign in, add items to a cart, check out with cash on delivery, and view their order history.

| Area | What's included |
| --- | --- |
| Catalog | Home page with categories, featured products and an optional filtered product list (sections switchable under **UI → Home page**), `/shop` with category filter + search, product detail pages with related products. Both product lists show **12 products per page** with a pager once a category has more – `/shop` through shareable `?page=` links, the home-page filter in place |
| Cart | Guest-friendly cart persisted in `localStorage` (Zustand), quantity controls, stock limits, shipping preview |
| Blog | `/blog` publishing area with the same modular block editor as Pages, featured images, shared tags, excerpts, SEO/canonical/robots/Open Graph fields, social cards, article metadata and sitemap entries |
| Auth | E-mail + password **and "Continue with Google"** (Supabase Auth, PKCE flow), sign out, protected routes, open-redirect-safe `?next=` handling |
| Checkout | Shipping form → atomic `place_order()` Postgres function (prices re-read from DB, stock locked & decremented, order number generated) |
| Orders | `/orders` history and `/orders/[id]` confirmation page, protected by Row Level Security |
| Security | RLS on every table, `SECURITY DEFINER` checkout RPC only executable by `authenticated`, JWT verified with `getClaims()` |
| Admin | `/nemesis` dashboard for users with `profiles.is_admin = true`: products (with image upload to Supabase Storage), categories, orders, users/roles, header / footer menus and site settings – see [Admin dashboard](#admin-dashboard) |
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

**One file, one paste.** On a fresh Supabase project you can skip the list below: open the **SQL Editor**, paste [`supabase/complete-setup.sql`](supabase/complete-setup.sql) (all 25 migrations in order + the API role grants + the demo catalog, ~3,460 lines) and press **Run**. It creates every table, policy, trigger and function, the `media` Storage bucket, 4 categories and 12 demo products. Delete the clearly-marked *OPTIONAL demo catalog* block at the end if you want an empty store. Verified end-to-end against a brand-new database: sign-up → profile, dashboard, creating users, checkout → order, chat, notifications.

**Or run the migrations one by one** (e.g. to follow what each one adds) – open **SQL Editor** → *New query* and paste each file in order:
   1. [`supabase/migrations/20261014000000_init.sql`](supabase/migrations/20261014000000_init.sql) – schema, RLS, `place_order()`
   2. [`supabase/migrations/20261015000000_google_auth.sql`](supabase/migrations/20261015000000_google_auth.sql) – `profiles.avatar_url` + Google-aware profile trigger (safe to run on an existing project)
   3. [`supabase/migrations/20261016000000_admin.sql`](supabase/migrations/20261016000000_admin.sql) – `profiles.is_admin`, admin RLS policies, `site_settings`, `admin_stats()` / `admin_delete_user()` and the (now legacy) `product-images` Storage bucket (safe to run on an existing project)
   4. [`supabase/migrations/20261017000000_category_menu.sql`](supabase/migrations/20261017000000_category_menu.sql) – `categories.show_in_menu` (the original header-menu toggle; superseded by migration 10, still required in between)
   5. [`supabase/migrations/20261018000000_settings_tabs.sql`](supabase/migrations/20261018000000_settings_tabs.sql) – settings tabs: contact links, favicon & SEO columns on `site_settings`, the global `manage_stock` switch (`stock_managed()`, honoured by `place_order()` and the order-status trigger) and the (now legacy) `site-media` Storage bucket (safe to run on an existing project)
   6. [`supabase/migrations/20261019000000_media_library.sql`](supabase/migrations/20261019000000_media_library.sql) – **Media Library**: `media`, `media_folders`, `product_media` (galleries), `products.image_media_id`, `media_usage()` / `media_totals()`, RLS and the public `media` Storage bucket (5 MB per file, admin-only writes). Safe to run on an existing project – current product images keep working as plain URLs
   7. [`supabase/migrations/20261020000000_single_media_bucket.sql`](supabase/migrations/20261020000000_single_media_bucket.sql) – **one bucket for everything**: `site_settings.favicon_media_id` / `seo_og_image_media_id` (favicon and share image become Media Library references), `media_usage()` also reports *site favicon* / *share image*, and admins may read / delete rows in `storage.buckets` so the legacy `product-images` and `site-media` buckets can be removed from the dashboard. Safe to run on an existing project
   8. [`supabase/migrations/20261021000000_pages.sql`](supabase/migrations/20261021000000_pages.sql) – **Pages**: `pages` (title, slug, rich-text content, featured image, draft / published, per-page SEO + Open Graph fields, author), `tags`, `page_tags`, `page_media` (images used inside the content), RLS (everyone reads published pages, admins manage everything) and `media_usage()` reporting *page image* / *page share image* / *page content*
   9. [`supabase/migrations/20261022000000_pages_image_urls.sql`](supabase/migrations/20261022000000_pages_image_urls.sql) – `pages.featured_image_url` / `og_image_url` so the featured and share image of a page can also be an external URL (*Use a URL*)
   10. [`supabase/migrations/20261023000000_menus.sql`](supabase/migrations/20261023000000_menus.sql) – **Menus**: `menu_items` (header / footer links to pages, categories or custom URLs, with their own text, new-tab flag and order) + RLS. Carries the current navigation over ("Shop" + the categories that were shown in the header; the footer's Shop / Cart / My orders) and **drops `categories.show_in_menu`** – menus are managed under **UI → Menu** from now on. Safe to run on an existing project
   11. [`supabase/migrations/20261024000000_home_sections.sql`](supabase/migrations/20261024000000_home_sections.sql) – **Home page sections**: `site_settings.home_show_categories` / `home_show_featured` / `home_show_filter` / `home_filter_title` – the switches behind **UI → Home page**. Defaults keep the home page exactly as it was (categories + featured on, filtered products off)
   12. [`supabase/migrations/20261025000000_currency.sql`](supabase/migrations/20261025000000_currency.sql) – **Currency**: `site_settings.currency` (`USD` / `BDT`, default USD) + `site_settings.usd_to_bdt_rate`, and `orders.exchange_rate` so every order remembers the currency and rate it was placed with (`place_order()` stamps them). Amounts stay in the base unit (USD) – nothing in `products` or `orders` is rewritten; migration 13 below makes that unit a micro-dollar. Safe to run on an existing project
   13. [`supabase/migrations/20261026000000_money_micros.sql`](supabase/migrations/20261026000000_money_micros.sql) – **Price precision**: every money column becomes an integer number of **USD micro-dollars** (`1 USD = 1,000,000`, so a cent is 10,000) and is renamed `*_cents` → `*_micros` (`bigint`); existing amounts are multiplied by 10,000, so no price changes value. A whole cent is 1.20 ৳ at a rate of 120, which is why a taka price used to come back as 99.60 ৳ when you typed 100 ৳. Run it **together with the matching app release** – the two are not compatible with each other
   14. [`supabase/migrations/20261027000000_variations.sql`](supabase/migrations/20261027000000_variations.sql) – **Variable products**: `products.type` (`simple` / `variable`) + `products.sku`, `product_attributes` (name + option values per product), `product_variations` (SKU, regular / sale price, stock, image, enabled flag – one row per combination) with RLS, the `product_variations_sync_parent` trigger that keeps the parent's price / stock in step, `order_items.variation_id` / `variation_label`, a `place_order()` that checks and decrements the *variation* that was bought, and restocking on cancellation. Products without attributes stay exactly as they are – safe to run on an existing project
   15. [`supabase/migrations/20261028000000_admin_stats_customers.sql`](supabase/migrations/20261028000000_admin_stats_customers.sql) – **Dashboard customer counts**: migration 13 re-created `admin_stats()` for the micro-dollar move and dropped `customers_total` / `customers_30d` on the way, so the dashboard card said *"undefined joined in the last 30 days"*. This re-creates the function with both keys back (nothing else changes). Safe to run on an existing project
   16. [`supabase/migrations/20261029000000_theme.sql`](supabase/migrations/20261029000000_theme.sql) – **Theme customization**: `site_settings.theme_light` / `theme_dark` (per-mode colour overrides), `theme_gradients` (button / loading-bar / hero gradients) and `theme_sync` – all `jsonb` / `boolean` with defaults, so an existing site keeps its exact colours until an admin saves the Extra tab. Safe to run on an existing project
   17. [`supabase/migrations/20261030000000_order_messages.sql`](supabase/migrations/20261030000000_order_messages.sql) – **Order inquiries**: `order_messages` (the turn-based chat thread of an order – `sender_type`, an author snapshot, a 200-character check) with RLS for the order's owner and every admin, select + insert only (messages are immutable). Safe to run on an existing project – without it the order pages simply don't render the thread
   18. [`supabase/migrations/20261031000000_presence.sql`](supabase/migrations/20261031000000_presence.sql) – **Presence & receipts**: `profiles.last_active_at` (the heartbeat stamp), the admin-only `profiles.presence_visibility` switch (`online` / `last_seen_only` / `offline`), `presence_status()` (online = active within 45 s), the `store_presence()` helper that applies an admin's privacy mode *inside the database* before a customer ever sees it, and `order_messages.delivered_at` / `seen_at` for the ✓ / ✓✓ receipts. Safe to run on an existing project
   19. [`supabase/migrations/20261032000000_order_message_receipts.sql`](supabase/migrations/20261032000000_order_message_receipts.sql) – **Receipt writes**: migration 17 made the thread immutable (SELECT + INSERT only), which also blocked the receipts added in 18. This adds one narrow UPDATE policy – the *recipient* may stamp `delivered_at` / `seen_at` on the other side's messages – plus the `order_messages_receipts_only` trigger that rejects every other change, so messages stay otherwise untouchable
   20. [`supabase/migrations/20261033000000_customer_visibility.sql`](supabase/migrations/20261033000000_customer_visibility.sql) – **Per-customer visibility**: `admin_customer_visibility` (one row per admin + customer, `online` / `last_seen_only` / `offline`, RLS for the owning admin only) with a trigger that seeds **`last_seen_only`** when a customer places an order, a backfill for customers that already ordered, and `store_presence_for(customer)` – `store_presence()` resolved against that customer's override, falling back to the admin's global switch when no row exists. Safe to run on an existing project
   21. [`supabase/migrations/20261034000000_notifications.sql`](supabase/migrations/20261034000000_notifications.sql) – **Notifications**: `notifications` (one row per recipient – `kind`, `title`, `body`, `href`, the order it is about, an author snapshot, `read_at`), RLS that lets a user read / stamp / delete **only their own** rows (there is deliberately no insert policy – only triggers write) and `notification_admins(actor)`; six triggers turn order events into notifications (new order → every admin, status change → the buyer, cancellation → the admins, payment → the admins, customer message → the admins, admin reply → the buyer). Safe to run on an existing project
   22. [`supabase/migrations/20261035000000_category_images.sql`](supabase/migrations/20261035000000_category_images.sql) – **Category images**: `categories.image_url` + `categories.image_media_id` (FK to `media`, `on delete set null`) so a category can show a picture on the *Shop by category* tiles – uploaded through the Media Library or pasted as a URL. Safe to run on an existing project (the tiles fall back to an icon)
   23. [`supabase/migrations/20261036000000_category_icons.sql`](supabase/migrations/20261036000000_category_icons.sql) – **Category icons**: `categories.icon` – the id of one of the 48 bundled Lucide icons an admin picks under **Categories → Category image & icons**. `null` means the default shopping bag. Safe to run on an existing project
   24. [`supabase/migrations/20261037000000_category_icon_color.sql`](supabase/migrations/20261037000000_category_icon_color.sql) – **Category icon colour**: `categories.icon_color` (`#rrggbb`, checked) – the fill behind that icon; `null` uses the theme's primary colour. Safe to run on an existing project
   25. [`supabase/migrations/20261038000000_category_no_icon.sql`](supabase/migrations/20261038000000_category_no_icon.sql) – **Category "Remove icon"**: `categories.icon_disabled` – the admin's switch to drop the icon from a category that has a picture, so the *Shop by category* tile shows the image alone. Safe to run on an existing project (default `false`, so every tile looks exactly as before)
   After the existing migrations, apply [`supabase/migrations/20261048000000_blog_posts.sql`](supabase/migrations/20261048000000_blog_posts.sql) – **Blog posts**: separate editorial posts with the same block editor model, SEO fields, tags, media tracking, publish state and admin/public RLS. Adds `/blog` navigation links; safe to apply to an existing database.
3. Paste [`supabase/seed.sql`](supabase/seed.sql) and run it to load the 12 demo products.
4. Make yourself an admin (after signing up once in the app – see [Admin dashboard](#admin-dashboard)):

   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```

> Using the Supabase CLI instead? `supabase link --project-ref <ref> && supabase db push`, then run the seed file with `supabase db query -f supabase/seed.sql` (or paste it in the SQL editor).

> `supabase/complete-setup.sql` is generated from the migrations – regenerate it after adding one:
> `python3 scripts/build-complete-sql.py` (or concatenate `supabase/migrations/*.sql` in filename order, then `supabase/seed.sql`).

### Configure environment variables

Open `.env.local` and fill in the values from **Project Settings → API** (or the *Connect* dialog):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # legacy "anon" key also works
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_STORE_NAME=Woo Solution
# optional – enables the "Suggest with AI" alt-text button in the Media Library (server-side only)
# OPENAI_API_KEY=sk-...
# OPENAI_ALT_TEXT_MODEL=gpt-4o-mini
# optional – enables Users → "New user" (creating logins needs Supabase's Admin API; server-side only)
# SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

**`SUPABASE_SERVICE_ROLE_KEY`** is only used by the *New user* dialog: a login cannot be created through RLS, so that one action calls `auth.admin.createUser()` with the secret key. It never reaches the browser – every caller passes `assertAdmin()` first, and without the variable the dialog says so instead of failing silently. Add it in the hosting provider's environment variables too (never in a `NEXT_PUBLIC_*` one).

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

### Updating an existing checkout

```bash
# 1. stop the dev server first (Ctrl-C) – on Windows a running `next dev` locks files
#    in node_modules and `npm install` silently leaves packages missing
git pull
npm install
# 2. run any new files in supabase/migrations/ in the Supabase SQL editor (in order)
npm run dev
```

> **"Can't resolve '<package>'" errors after an update** mean the install did not finish – stop the dev server, run `npm install` again (it must end without `npm ERR!`), delete the `.next` folder (Turbopack caches compiler results on disk) and start `npm run dev` afresh.

### Admin dashboard

The back office lives at **`/nemesis`** (deliberately not linked anywhere public). Access is decided by one flag in the database – `public.profiles.is_admin` – and enforced in three layers:

1. `src/proxy.ts` redirects signed-out visitors to `/login?next=/nemesis`.
2. `src/app/nemesis/layout.tsx` calls `requireAdmin()`; a signed-in user without the flag gets the normal **404** page (the route doesn't reveal itself).
3. Every Server Action re-checks the flag **and** Postgres RLS only lets admins write to `products`, `categories`, `orders`, other users' `profiles`, `site_settings` and the `media` bucket. Promoting someone through the UI or the API without being an admin is rejected by a trigger.

**Bootstrapping the first admin** – nobody is an admin by default. Sign up in the app (e-mail or Google), then run in the SQL Editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

Reload the page and an **Admin** link appears in the header. From then on you can grant/revoke admin for other users in *Users*.

| Section | What you can do |
| --- | --- |
| Dashboard | Revenue / order / product / customer stats, orders by status, recent orders, low-stock list |
| Pages | Static content pages (About, Contact, Privacy policy, FAQ …) with a rich-text editor, featured image, tags, draft / published workflow, preview and per-page SEO – see [Pages](#pages) below. Each published page is live at `/<slug>` |
| Products | Create, edit, delete; search & filter; draft/active, featured, stock, **regular price** (+ optional **sale price**); **main image** + **gallery** picked from the Media Library (upload a new file or select an existing one – see [Media](#media)), or paste any image URL. Each product is **Simple** or **Variable** – see [Variable products](#variable-products) |
| Categories | Create, rename, delete (products become uncategorised); **drag the handle** (mouse, touch long-press, or ↑/↓ on a focused handle) to reorder – the shop's category filter and the sitemap follow the saved order. Which categories appear in the storefront navigation is decided under **UI → Menu** |
| Orders | Filter by status, view items & shipping address, reply in the **order inquiry thread** (see [Order inquiries](#order-inquiries)), change order / payment status (cancelling restocks the items, re-opening reserves them again), delete |
| Notifications | The admin bell’s full page (see [Notifications](#notifications)): All / Unread / Orders / Messages, per-page selector, bulk mark-read / delete |
| Users | View customers with their order history, edit name/phone, grant or revoke **Administrator**, delete a user (their orders are kept), and **create** an account from the **New user** dialog (name, e-mail, phone, role, password — see [Creating users](#creating-users)). You can't demote or delete yourself |
| Media | The Media Library – see [Media](#media) below: uploads, grid / list browsing, search, filters, folders, trash, bulk actions, image optimisation / WebP conversion / editing, alt text, usage tracking and the reusable **media picker** |
| Extra | Three tabs. **Menu** – see [Menus](#menus) below: build the storefront **header** and **footer** navigation from pages, categories and custom links, drag to reorder, edit link text, open in a new tab. **Home page** – see [Home page](#home-page) below: switch the home-page sections on and off, including a filtered product list with its own title. **Extra** – see [Theme customization](#theme-customization) below: colours and gradients for light **and** dark mode, presets, reset |
| Settings | Three tabs – see [Settings](#settings) below: **General** (site title, tagline, support e-mail, WhatsApp, Telegram, favicon, plus the **Presence** card with the global visibility fallback), **SEO** (search-engine visibility, site URL, title / meta description, share image, verification codes, X handle) and **WooCommerce** (global stock management switch, store currency USD / BDT + exchange rate) |

The **Pages, Products, Orders and Users** lists are paginated: `?page=` + a **per-page** selector (10 / 20 / 50 / 100, top right of the table, `?per=`, remembered per admin in a cookie). Changing the size keeps the first visible row on screen, a new filter starts on page 1, a page that no longer exists redirects to the last one, and view / edit / delete bring you back to the exact page, size and filter you came from.

**Bulk delete** – the same lists have a checkbox column. Tick rows (the header checkbox selects the whole page, Shift+click selects a range, Space toggles the focused row) and a floating **N selected → Delete** bar appears; confirming removes them in one go and reports the result as a toast. Rows are links as well: click anywhere on a row to open it while nothing is selected – once something is ticked, clicking a row toggles it instead. Your own account can be opened but never selected, and `deleteUsers` additionally skips the caller's id on the server.

Every action reports back through a toast notification (bottom-right corner of the dashboard, [sonner](https://sonner.emilkowal.ski/)) – successes in green, failures in red – while validation errors stay next to the fields they belong to.

#### Creating users

**Users → New user** (top right) opens a modal that creates an account without going through the sign-up page: **Full name**, **E-mail**, **Phone**, **Role** (*Customer* / *Administrator*) and **Password**.

| | |
| --- | --- |
| Password | starts as a freshly generated **20-character** password (letters, digits and symbols, look-alikes left out) and the **Generate** button makes another one. The eye icon hides / shows it, the copy icon puts it on the clipboard; a four-step meter under the field says Weak / Fair / Good / Strong. The server requires at least 8 characters with a letter and a number |
| Role | *Administrator* sets `profiles.is_admin`; the new admin can sign in and open `/nemesis` straight away. *Customer* gets the normal storefront account |
| Created | through `auth.admin.createUser()` on the Supabase Admin API (service-role key, server-side only) with the address already confirmed – the admin sets the password by hand, so there is nothing to confirm by e-mail. The `on_auth_user_created` trigger writes the profile row, then name / phone / role are filled in |
| Validation | missing name, a malformed e-mail, a short password or an address that already has an account each show **under their own field**; the dialog stays open with everything you typed (except the password, which is never echoed back). Success closes it, toasts, and the new row is in the list |
| Closing | the **Create user** / **Cancel** buttons, the **×** or **Escape** – reopening always starts from a clean form |
| Name in the header | the moment they sign in, the storefront header shows their **avatar initial + first name** (*H Hasib*) and the account menu the full name and e-mail; the dashboard sidebar shows the full name too. The name is read from the **profile row**, so renaming the account later under Users → *Edit* (which only writes `profiles`) changes the header at the next render – the auth metadata is updated alongside it when the service key is set |


#### Variable products

**Products → New product** starts with a **Product type** selector. *Simple product* is the classic form (regular price, optional sale price, SKU, stock). *Variable product* hides those four fields – the price and the stock of a variable product are computed from its variations – and reveals two new cards.

**Prices: a regular price and an optional sale price.** The *regular price* is what the product normally costs and is always required. The *sale price* is optional, needs a regular price to discount, and must be **lower** than it – the storefront then charges the sale price and strikes the regular one through. Leave the sale price empty and the regular price is simply what customers pay (nothing is struck through). Both rules are enforced in the form and on the server; the same two fields, with the same rules, exist on every variation.

**Attributes** – add up to five attributes (e.g. *Color*, *Size*) and type their values as tags/chips (up to 30 each; Enter or comma adds one, click the × removes it). Nothing is saved until you press *Save product*.

**Variations** – **Generate variations** builds the full cartesian product of the attribute values (*Red / Blue* × *S / M* → 4 rows) and asks for confirmation before overwriting existing rows; the combinations you already had keep their price, stock, SKU and image. If you change the attributes again, **Generate variations** restores the missing rows and only drops the ones whose combination is gone.

Every row is its own variant: **SKU** (type it, or *Auto SKUs* fills every empty one from the product name + attribute values, e.g. `RED-S`), **regular price** and an optional **sale price** (same rule as above – lower than the regular price, and without one the regular price is charged), **stock**, an optional **image** (*Choose* opens the Media Library picker – a variation image is used on the storefront as soon as that combination is selected), an **enabled** switch and a delete button. Rows can be deleted before saving; the card header counts them and warns about enabled rows without a regular price.

Above the table, **Bulk edit** applies one value to everything: *Set regular price for all*, *Set sale price for all*, *Set stock for all*, *Enable all*, *Disable all*. A variable product **cannot be saved** without attributes, without at least one enabled variation that has a regular price, or with no variations at all – the reason appears in the card, and nothing is written to the database.

What the database does behind the form (migration 14):

- `product_attributes` and `product_variations` are related rows; a variation stores the combination it stands for (`{ "Color": "Red", "Size": "S" }`), the label customers see (*Red / S*) and a unique constraint on `(product_id, combination)` – generating twice can't duplicate a row.
- Saving replaces the attributes and upserts the variations (existing ids survive, so rows are updated rather than deleted and re-created); the rows whose combination disappeared are removed. **Switching a product back to Simple deletes its attributes and variations.**
- The parent row keeps a *summary*: `products.price_micros` = the cheapest **enabled** variation, `products.compare_at_price_micros` = `NULL` (the shop shows *From $10.00*, without a strike-through) and `products.stock` = the sum of the enabled variations. The `product_variations_sync_parent` trigger does that on every variation write, so the admin list, the shop cards and the low-stock dashboard card are always right.

On the storefront the page of a variable product shows one dropdown per attribute instead of the plain price; the charged price (the sale price when the chosen variation has one, with its regular price struck through), the *Only N left in stock* / *Sold out* badge, the summary and the image follow the chosen combination, combinations that don't exist are marked *— unavailable* and disabled, and **Add to cart** stays disabled until a real, in-stock combination is picked. The shop card shows *Choose options* instead of *Add to cart* and lists *From <cheapest price>*. Every variation is its own cart line (`Blue / S` and `Red / S` sit next to each other with their own price and stock), cancelling an order restocks the variation that was bought, and both the storefront order page and the admin order page name the variation – `order_items` keeps `variation_id` *and* a copy of the label, so deleting a variation later never rewrites the history of an order.
#### Menus

`/nemesis/ui` → **Menu** manages the storefront navigation – **Extra** sits directly above **Settings** in the sidebar — the entry is called **UI**, points at `/nemesis/ui` and therefore always opens the page on its first tab, *Menu*; the tab itself is reachable at `?tab=extra`.

- **Location** – switch between the **Header menu** (top of every page, also the mobile hamburger sheet) and the **Footer menu** (`?location=footer`). Each location is its own list.
- **Add to menu** – pick a **page** (drafts are listed too, but stay hidden in the storefront until published), a **category**, or enter a **custom link** (link text + URL; a path on this site such as `/about`, a full `https://` address, `mailto:` or `tel:`; `javascript:` and friends are rejected) with an optional *open in a new tab*. Pages and categories already in the menu are left out of the pickers. New items join the end of the list.
- **Order** – drag the handle (mouse, touch long-press, or ↑ / ↓ on a focused handle) exactly like the categories table; the order is saved on drop ("Menu order saved.").
- **Edit / Remove** – change the link text (independent of the page / category name), the URL of a custom link and the new-tab flag; removing an entry never deletes the page or category behind it.
- Everything is live immediately: header and footer are part of the static shell, cached with a tag that every menu, page and category write invalidates. Deleting a page or category also removes its menu entries (foreign keys), renaming a page changes its link target automatically.

#### Home page

`/nemesis/ui?tab=home` → **Home page** decides which sections the storefront home page shows below the hero, in the order they appear on the page. One switch each, one **Save changes**, live immediately:

- **Shop by category** – the category tiles (on by default).
- **Featured products** – the eight products flagged *Featured* with the *View all* link to the shop (on by default).
- **Filtered products** – the shop's category filter on the home page (off by default): a row of pills (*All* + every category in the admin's category order), a product count and the product grid. Switching a pill filters the grid instantly in the browser – no page change, no URL change. More than 12 products in the selected category → a pager (Previous · 1 2 3 · Next) under the grid that swaps the 12 cards in place and scrolls back to the top of the section; switching a pill starts again on page 1. **Section title** is the heading above the pills (optional, up to 80 characters, e.g. *Browse our products*); leave it empty for no heading.

The settings live in `site_settings` (migration 11); the storefront reads them through the same tag-cached `getSiteSettings()` as the rest of the site, so a save invalidates the home page straight away. Switching every section off leaves only the hero.

#### Theme customization

`/nemesis/ui?tab=extra` → **Extra** restyles the whole store – storefront *and* dashboard – without touching code. The **UI** sidebar entry (directly above *Settings*) opens the page on *Menu*; the tab's own address is `/nemesis/ui?tab=extra` (and a typed `/nemesis/extra` redirects there).

| Control | What it does |
| --- | --- |
| **Light / Dark toggle** | Edit either mode. *Editing Light mode* / *Editing Dark mode* tells you which one you are looking at, and the preview card follows it |
| **Primary** | Links, badges, active states, focus rings – `--primary`, `--ring`, `--accent`, the sidebar accents and `--chart-1` follow it, and the readable text colour is derived from it |
| **Secondary** | Secondary buttons, chips and muted surfaces (`--secondary` + its foreground) |
| **Button** | Every primary button – *Add to cart*, *Buy now*, *Save changes*, *Checkout* (`--button`) |
| **Button hover / active** | The shade a primary button turns under the pointer or while its menu is open (`--button-hover`). Left empty it behaves like before (80 % of the button colour) |
| **Loading bar** | The progress bar at the very top of the page (`--loader`) |
| **Use the same colors for both Light & Dark modes** | Copies the light palette into dark and keeps the two in step while it is on |
| **Presets** | Twelve ready-made palettes – *Modern Indigo*, *Emerald Tech*, *Sunset Coral*, *Ocean Cyan*, *Violet Dusk*, *Rose Quartz*, *Amber Sunrise*, *Forest Pine*, *Teal Lagoon*, *Sky Breeze*, *Crimson Ember*, *Graphite* – each with its own light **and** dark colours plus a matching hero gradient; one click fills every colour field in both modes |
| **Gradients** | *Button*, *Loading bar* and *Hero* can each carry a **linear** (with an angle slider) or **radial** gradient, two or three stops, with a preview strip |
| **Reset to defaults** | Asks first, then clears both palettes and every gradient back to the template colours – save to publish it |

**How the picker works.** Every colour field opens a popover with a saturation/brightness area and a hue slider (React Aria `ColorPicker`), one input that understands and reformats **HEX, RGB and HSL** (`#0891b2` → `rgb(8, 145, 178)` → `hsl(186, 91%, 38%)`), quick swatches, an eyedropper button (EyeDropper API where the browser has it, the OS picker otherwise) and *Template* to drop the override for that single token.

**What is stored.** Colours stay exactly as typed; `src/lib/theme.ts` validates them on both sides and `themeVars()` converts them into design tokens (a custom primary also derives `--primary-foreground`, the focus ring, the accent and the sidebar accents so nothing becomes unreadable). `normaliseTheme()` / `normaliseGradients()` fall back to the template for anything unknown, and a token nobody touched is simply not emitted – which is why *Reset* and an untouched site look identical. The root layout renders the result as a `<style>` tag from the tag-cached settings row, so the first paint already carries the palette; the hero takes its text colour from the gradient's own brightness, and the loading bar reads the values through a small client context for its gradient. Saving invalidates the `site-settings` tag like every other settings save.

#### Settings

`/nemesis/settings` is organised in tabs (shadcn/React Aria `Tabs`; every tab is its own form and Server Action, unsaved edits survive switching, `?tab=seo` deep-links). Everything saved there is live immediately – the `site_settings` row is cached with a tag that each save invalidates.

| Tab | Options | Where it shows up |
| --- | --- | --- |
| General | Site title, tagline, support e-mail, **WhatsApp** number, **Telegram** username, **favicon** (*Choose icon* opens the Media Library picker – pick an existing ICO / PNG / SVG / WebP or upload a new one; uploads land in the **Branding** folder) | `<title>` template, header, hero, footer (e-mail / `wa.me` / `t.me` links), `<link rel="icon">`, Organization JSON-LD. The favicon is stored as a media reference (`favicon_media_id`), so renaming / replacing the file in the library updates the site; *Remove* only unlinks it – the file stays in the library |
| SEO | **Search engine visibility** switch, site URL, home page title, meta description (with a 160-character guide), social share image (Open Graph 1200 × 630 – picked from the Media Library or uploaded into its **Branding** folder, stored as `seo_og_image_media_id`), Google Search Console + Bing Webmaster verification codes (paste the token or the whole `<meta>` tag), X / Twitter handle | `<meta name="robots">` (`noindex, nofollow` when visibility is off), `/robots.txt` (disallows everything when off, otherwise `/nemesis`, `/preview`, `/cart`, `/checkout`, `/orders`, `/login`, `/signup`, `/auth` + the sitemap line), `/sitemap.xml` (home, shop, categories, active products, published pages – tag-invalidated on every admin write), canonical URLs, Open Graph / Twitter cards, `google-site-verification` / `msvalidate.01` meta tags, Organization + WebSite (SearchAction) JSON-LD. Cart, checkout, orders, login and signup are always `noindex` |
| WooCommerce | **Manage stock** switch (on by default); **Currency** – *Store currency* (USD ($) or BDT (৳), default USD) and, only while BDT is selected, the *Exchange rate* field (`1 USD = … BDT`) | Off = every product is unlimited (digital goods): no "sold out" / "only N left" badges, quantities are only capped by `MAX_QTY_PER_LINE`, `place_order()` neither checks nor decrements `products.stock`, cancelling / re-opening orders doesn't move stock, the admin stock column / field and the low-stock dashboard card disappear (stored quantities are kept untouched). On = the previous strict behaviour |

Without a site URL the app falls back to `NEXT_PUBLIC_SITE_URL` for absolute URLs (sitemap, canonicals, JSON-LD).

**How prices are stored.** A product (and each variation) keeps two amounts in the base unit: `price_micros` – what the customer actually pays – and `compare_at_price_micros` – the regular price it discounts, kept only while a sale price is set. Without a sale price the two are the same value, so the storefront simply shows one price. Nothing is duplicated on the product form: *Regular price* + *Sale price* are the only price inputs you ever see.

**How the currency works.** The database always stores the *base* amount – an integer number of **USD micro-dollars** (`products.price_micros`, `orders.*_micros`, `order_items.*_micros`, the cart): `1 USD = 1,000,000`, so one cent is 10,000 micros. The WooCommerce tab only changes what people *see*: with BDT selected every amount – storefront, cart, checkout, dashboard, order lists – is shown as `৳` using `micros × rate ÷ 10,000`. In the admin product form the price inputs carry the active symbol (`$` / `৳`) and show the **converted** amounts; whatever you type there is converted back with the same rate and saved as micros, while prices you don't touch are written back exactly as they were stored (switching the currency never rounds or rewrites the catalogue). Because the base unit is a ten-thousandth of a cent, the amount you type comes back unchanged in either currency – `100 ৳` stays `৳100.00`, `1 ৳` stays `৳1.00`, `19.99` stays `$19.99` (a whole cent would snap every taka price to the nearest 1.20 ৳ at a rate of 120). Orders are stamped with `currency` + `exchange_rate` when they are placed, so an order taken in BDT keeps showing ৳ (at that day's rate) after you switch back to USD. The free-shipping threshold ($50) and flat rate ($5) stay USD-based in `src/lib/config.ts` / `calculate_shipping()` and are displayed converted. Choosing BDT without a usable rate is rejected (the base price is never multiplied by nothing); the last rate is remembered when you go back to USD. Admin pages read the settings on every request, so a currency switch shows up in the dashboard and price fields immediately; the public pages keep serving their cached shell and pick it up within a few seconds.

Branding images (favicon, share image) are served through `next/image`; `*.supabase.co` and a few stock-photo hosts are allow-listed in `src/lib/image-hosts.ts` – add your own CDN there. Plain-`http` URLs (e.g. a local Supabase on `127.0.0.1`) are rendered unoptimised.

#### Order inquiries

Both the customer's order page (`/orders/[id]`) and the admin's (`/nemesis/orders/[id]`) carry the same **Order inquiries** thread – a turn-based chat that updates in real time over **Server-Sent Events**, so a reply appears in the other tab without a reload.

| Rule | Behaviour |
| --- | --- |
| Open statuses | **Pending** and **Cancelled** – post-cancellation questions and refund follow-ups stay possible |
| Closed statuses | **Processing** and **Completed** – the composer is replaced by *"Inquiries are closed for this order status."* and the API refuses the post as well |
| Turn rule | a customer holds the pen until they post, then waits for an admin reply; admins can send as many messages back to back as they want. Enforced by the POST route, not just in the UI |
| Length | 200 characters, counted live under the field (`145 / 200`, red and Send disabled over the limit); the same limit is a `CHECK` constraint in the database |
| Author | customers show their profile picture (initials as fallback), admins show the store's shield badge. Admin messages sit left, customer messages right – in both views |
| Presence | the chat header shows a green dot and **Online**, or **Last seen 10:42 AM** / **Offline** – and who is on the other side: the customer always sees **Admin** with the store's shield badge (never a real name or photo), the admin sees the buyer's profile. The heartbeat (`POST /api/presence/ping`, every 25 s) stamps `profiles.last_active_at`; "online" simply means that stamp is younger than 45 s |
| Privacy | the dropdown in the chat header sets what **this customer** may see: **Online**, **Last seen only** or **Offline**; every new order starts at *Last seen only*, and the *Presence* card in Settings holds the global fallback for customers without an override. The filter runs inside `store_presence_for()` (customer ids may only be asked about by that customer), so a hidden stamp never leaves the database – the SSE stream carries the filtered value too |
| "Online" is real | the switch never fabricates it: *Online* means the heartbeat is younger than 45 s. Close the tab, lose the connection, or leave the computer idle for `PRESENCE_IDLE_AFTER_MS` (2 min – no mouse, key, scroll or touch) and the pinger pauses, so that customer reads **Last seen 10:42 AM** until you are back at the keyboard (the first sign of life pings immediately) |
| Receipts | every bubble shows its own time and – on your messages – its status **outside the bubble, just below it** (✓ sent, ✓✓ delivered, ✓✓ seen in green), aligned to the side the bubble sits on; the new-message line under the composer repeats the newest one (**10:42 PM · Sent / Delivered / Seen**). Stamped by the other side, pushed over SSE as a `receipt` event the moment they open the thread, and only "seen" when that tab is actually visible |
| Customer-side "Seen" | the customer is shown **Seen** only while that admin is visible as online *and* has answered the message (`customerVisibleReceipt()`): reading is not answering, so a message the admin has really read stays ✓✓ *Delivered* for the buyer until a reply follows, and drops back to *Delivered* while the admin is hidden or away. The stored receipts are never touched – the admin's own thread always shows the real ✓ / ✓✓ / Seen |
| Look | the thread stays **256 px tall** however long it gets (it scrolls, it never grows), the scrollbar is invisible in every engine (`.scrollbar-hidden`) while the wheel / touch still work, and it scrolls to the newest message smoothly on open and on every message that arrives. Bubbles ease in, the live dot breathes – both fall back to no motion under `prefers-reduced-motion` |
| Scrolling past the ends | `overscroll-behavior: auto` on the message list (the browser default) – at the newest message a further downward wheel / swipe scrolls the **page** on, at the oldest message it scrolls the page back up, instead of the gesture dying inside the box. Inside the thread the wheel only moves the thread |

| Endpoint | What it does |
| --- | --- |
| `GET /api/orders/[id]/chat` | the thread, oldest first (`?since=<ISO>` for the delta only) |
| `POST /api/orders/[id]/chat` | validates session + ownership (RLS), status, turn rule and length – then stores the message and pushes it to every open stream |
| `POST /api/orders/[id]/chat/receipt` | the recipient stamps `delivered` / `seen` and the sender's open tabs hear about it |
| `POST /api/presence/ping` | the heartbeat: stamps the signed-in user's `last_active_at` (201; a 401 stops the background pinger) |
| `GET /api/orders/[id]/chat/stream` | `text/event-stream`: replays what the page missed on connect, then pushes `message`, `receipt` and `presence` events (`retry: 3000`, comment pings). The POST routes publish over an in-process bus, a 2 s database poll catches missed broadcasts and presence is re-read every 8 s |

The thread is one row per message in `order_messages` with a snapshot of the author's name / avatar, so it keeps rendering after a profile edit or a deleted account. There is no update or delete policy – messages are immutable, and deleting an order deletes its thread (cascade) – which the dashboard's *Delete order* button (and bulk delete) both use. Sign in as the customer and the admin in two windows to see a message cross over in about a second – as do the ✓ / ✓✓ receipts and the "Online" / "Last seen" state.

#### Notifications

Every signed-in tab keeps **one** Server-Sent Events connection (`GET /api/notifications/stream`) and gets a bell in its header – the same `NotificationBell` component on the storefront and in the dashboard top bar. There is no polling and no WebSocket anywhere in the feature.

| | Customer bell | Admin bell |
| --- | --- | --- |
| Fires on | order status **Processing / Completed / Cancelled**, an **admin reply** in the order thread | a **new order** from any customer, a **new customer message / inquiry**, **payment received**, an order **cancelled** |
| Click | the order page `/orders/<id>` | the dashboard order page `/nemesis/orders/<id>` – the thread is right there |
| Badge | the unread count, rendered on the server for the first paint, then kept live over SSE | same |

**How the stream works.** The connection opens with `EventSource` for every signed-in tab (opened by the first component that subscribes, closed when the last one unmounts – which is what signing out does), sends `retry: 3000` for the browser's own reconnect, a `snapshot` frame with the newest notifications and the unread count, then one `notification` frame per new row plus `unread` when the count moves. A `: ping` comment every 20 s keeps proxies from closing the idle connection, and the loop re-reads the table every 2 s so an event written by another process is never missed. Frames are small JSON objects – the row itself and nothing else. A reconnect replays what the tab missed (the snapshot carries the newest rows, the client keeps the list deduplicated by id), and coming back to a background tab re-reads once.

**The bell.** A popover with the six newest rows – kind tile, title, body, actor, *just now / 14 min ago / 2 days ago*, unread dot – a **Mark all read** shortcut, a live dot (green = connected, grey = reconnecting) and **View all notifications**. It is a non-modal popover, so the page behind it stays clickable. Rows are links: clicking one marks it read and goes to its `href`.

**The pages.** `/notifications` (customer) and `/nemesis/notifications` (admin) are the same board component: tabs **All / Unread / Orders / Messages** (`?tab=`), 12 per page with `?page=` (the dashboard adds its usual `?per=` selector), checkboxes with *Select all*, and a floating bulk bar – **Mark as read** and **Delete** (with a confirmation dialog). A deep link keeps the filter, and every row is a link to its own target, so the redirect never needs to know which role is looking.

| Endpoint | What it does |
| --- | --- |
| `GET /api/notifications` | `?preview=1&limit=8` → `{ items, unread }` for the bell; `?filter=all\|unread\|orders\|messages&page=&per=` → `{ items, total, page, pageCount, unread }` for the board |
| `POST /api/notifications/read` | `{ ids: [...] }` or `{ all: true }` → `{ ok, unread }` (RLS makes another user's ids a no-op) |
| `POST /api/notifications/delete` | `{ ids: [...] }` → `{ ok, unread, deleted }` |
| `GET /api/notifications/stream` | `text/event-stream`: `retry: 3000`, `snapshot`, `notification`, `unread`, `refresh`, `: ping` |

The triggers are the only writer, which is why the browser can never fabricate a notification: `notifications` has SELECT / UPDATE / DELETE policies for `recipient_id = auth.uid()` and **no INSERT policy at all**.

#
### Pages

`/nemesis/pages` is a small CMS for everything that is not a product: About us, Contact, Privacy policy, Terms, FAQ, Shipping & returns … Each page is rendered by one storefront template at **`/<slug>`** (header, footer and breadcrumbs included), so an *About us* page is simply `/about-us`.

| | |
| --- | --- |
| List | Title, URL, tags, **status** (switchable right in the row), author, updated / published dates; search by title or slug; filter by status; sort by last updated, published, title or created; pagination + per-page selector; **View** (published) / **Preview** (draft) and Edit per row; bulk **Publish**, **Move to drafts** and **Delete** |
| Editor | Title (≤ 200 characters) with a **URL slug** that is generated as you type and can be edited – it is checked live against existing pages and the reserved storefront routes (`shop`, `cart`, `products`, `nemesis` …) and a free alternative is suggested on a clash. The **content** editor (Tiptap, `rich-text-editor.tsx`) offers headings H1–H3, paragraphs, bold / italic / underline / strikethrough, bulleted and numbered lists, block quotes, code, links, alignment, horizontal rules, tables and **images picked from the Media Library** (or uploaded on the spot); the toolbar is keyboard-accessible and Ctrl/⌘-B / I / U / Z / Y work as expected |
| Featured image & tags | The featured image is picked from the Media Library (upload or select) **or pasted as any public image URL** (*Use a URL*, like the product form); it is shown at the top of the page and used as the default share image. **Tags** are free-form chips with suggestions from existing tags – stored in `tags` / `page_tags` and shown on the page |
| Publishing | The sticky **Publish** card shows the status, author and timestamps and offers *Save draft* / *Publish* (or *Update* / *Move to draft* once published), **Preview** (drafts included – `/preview/pages/<id>`, admins only) and *View live page*. Publishing requires a title and some content; `published_at` is set the first time a page goes live. The form warns before you leave with unsaved changes |
| SEO | A collapsible **Search engine settings** panel per page: SEO title (defaults to the page title, counts towards the 60-character guide), meta description (160-character guide), **canonical URL**, *Allow indexing* / *Follow links* switches, Open Graph title / description and a share image picked from the Media Library (or an external URL) – with a live **Google result preview**. Published, indexable pages are listed in `/sitemap.xml` and get canonical, robots, Open Graph (`type=article`) and Twitter card tags |
| Rendering | Content is sanitised on save **and** again on render (`src/lib/pages/sanitize.ts`: allow-listed tags / attributes, `http(s)` / `mailto` / `tel` links only, images only from the configured hosts, external links get `rel="noopener noreferrer"`), then styled by the `.rich-text` rules in `src/app/globals.css` (no typography plugin). Published pages are cached and tag-invalidated (`pages`, `page:<slug>`) whenever an admin saves, so edits appear immediately while visitors are served from the cache. Drafts and unknown slugs are a real 404 |

### Media

`/nemesis/media` (sidebar → **Media**, just above Settings) is a WordPress-style media library backed by the public `media` Storage bucket and the `public.media` table. **It is the only Storage bucket the app uses** – product images, galleries, the favicon and the share image all live there (branding files in the *Branding* folder).

| Area | What it does |
| --- | --- |
| Upload | Drag & drop or browse, several files at once, **any file type up to 5 MB** (active content such as `.html`, `.js`, `.exe`, `.php` … is refused for safety – the list lives in `src/lib/media/shared.ts`). Per-file and overall progress bars, clear size / type errors, duplicate detection (same bytes already in the library → *Skip* or *Upload anyway*). Files go browser → Storage directly, then the server verifies the stored bytes, records dimensions and generates **thumbnail / medium / large** WebP renditions (never upscaled) |
| Browse | Grid ⇄ list toggle, name / type / size / dimensions / upload date, storage totals (library + trash), **Show per page** 12 / 24 / 48 / 96 (`?per=`, remembered in a cookie), pagination, loading and empty states. Everything lives in the URL (`?q&kind&folder&from&to&size&sort&page&view&trash`) so views are shareable |
| Find | Search by name; filter by type (Image / Video / Document / Other), **date range** (calendar), **file size** (under 100 KB / 100 KB – 1 MB / over 1 MB) and folder; sort by date, name, size or type |
| Per file | Click a tile → detail dialog with a large preview (or a file-type icon), type, size, dimensions, upload date, full URL, **alt text** (+ *Suggest with AI* when `OPENAI_API_KEY` is set), folder, usage, and the actions **Copy URL · Download · Rename · Replace file · Edit image · Optimize · Move to trash**. Renaming only changes the display name and *Replace file* keeps the same path – the URL never changes |
| Bulk | Select All / Clear Selection; download as a zip; move to a folder; optimise / convert; move to trash. From the **Trash** view: restore, delete permanently (also removes the renditions from Storage) or **Empty trash** – permanent deletion is only possible from the trash |
| Images | **Optimize** (re-encode without visible quality loss, adjustable quality slider), convert PNG / JPEG → **WebP** (or AVIF), single or bulk with a progress bar and a before/after size summary. **Edit**: crop (free or fixed ratios), rotate, flip – *Apply* overwrites the file in place, *Save as a copy* creates `<name>-edited.<ext>` |
| Organise | Flat **folders** (create / rename / delete – files are kept, just unfiled), usage tracking (*Used in 1 product* on the tile, product links in the detail dialog), soft delete with a trash |
| Picker | The **media picker** (`src/components/admin/media/media-picker.tsx`) is the same library as a dialog: on the product form *Add image* / *Add images* offer **Media Library** (browse, search, filter, grid / list, single or multiple selection) or **Upload new**. Products store the **media reference** (`products.image_media_id`, `product_media` for the gallery) – not just a URL – so renaming, replacing, trashing or converting a file is reflected everywhere it is used. The storefront product page shows the main image plus a switchable gallery with the alt text. Settings use the same picker for the **favicon** and the **share image** (`media-ref-field.tsx`) |
| Legacy buckets | Projects created before the Media Library also have `product-images` and `site-media` buckets. While they still exist, the Media page shows a **Files from before the Media Library** card listing every file in them with a one-click *Move N files into the Media Library* button: each file is copied into `media` (identical bytes reuse the existing library item, branding files go to the *Branding* folder), every product `image_url` and the favicon / share-image settings that pointed at the old URL are repointed, the old object is deleted and – once both buckets are empty – the buckets themselves are removed. The card disappears when they are gone. If a bucket still contains files the importer could not handle, it stays and can be deleted by hand under *Storage → Buckets* |

Technical notes: uploads are validated twice (browser + server, including the real stored size and type), Storage policies allow writes to the `media` bucket for admins only, renditions and conversions use [sharp](https://sharp.pixelplumbing.com/), zips are built with [fflate](https://github.com/101arrowz/fflate), and every long-running action (uploads, bulk optimise, zip downloads) reports progress and finishes with a toast.

---

## 2. Project structure

```
woo-solution/
├── supabase/
│   ├── migrations/20261014000000_init.sql   # schema, RLS, triggers, place_order() RPC
│   ├── migrations/20261015000000_google_auth.sql
│   ├── migrations/20261016000000_admin.sql  # is_admin flag, admin RLS, site_settings
│   ├── migrations/20261017000000_category_menu.sql  # categories.show_in_menu (dropped again by …_menus.sql)
│   ├── migrations/20261018000000_settings_tabs.sql  # contact/SEO/stock settings, stock_managed()
│   ├── migrations/20261019000000_media_library.sql  # media library tables, galleries, media bucket
│   ├── migrations/20261020000000_single_media_bucket.sql  # favicon/share image as media refs, legacy-bucket cleanup
│   ├── migrations/20261021000000_pages.sql  # pages, tags, page_tags, page_media
│   ├── migrations/20261022000000_pages_image_urls.sql  # external featured / share image URLs
│   ├── migrations/20261023000000_menus.sql  # menu_items: header / footer navigation (UI → Menu)
│   ├── migrations/20261024000000_home_sections.sql  # home-page section switches + filter title (UI → Home page)
│   ├── migrations/20261025000000_currency.sql     # store currency (USD / BDT) + USD→BDT rate, orders.exchange_rate
│   ├── migrations/20261026000000_money_micros.sql # prices become USD micro-dollars (1 USD = 1,000,000); *_cents → *_micros
│   ├── migrations/20261027000000_variations.sql   # variable products: type/sku, attributes, variations, place_order()
│   ├── migrations/20261028000000_admin_stats_customers.sql  # dashboard customer counts (dropped by the money rewrite)
│   ├── migrations/20261029000000_theme.sql        # theme customization: palettes + gradients (Extra → Theme Customization)
│   ├── migrations/20261030000000_order_messages.sql  # order inquiries: the per-order chat thread (order_messages)
│   ├── migrations/20261031000000_presence.sql      # presence (heartbeat + admin visibility) and read receipts
│   ├── migrations/20261032000000_order_message_receipts.sql  # the narrow UPDATE policy + trigger behind ✓/✓✓
│   ├── migrations/20261033000000_customer_visibility.sql  # per-customer online visibility + store_presence_for()
│   ├── migrations/20261034000000_notifications.sql  # notifications + the six order/message triggers
│   └── seed.sql                             # demo categories + products
├── src/
│   ├── proxy.ts                             # refreshes the Supabase session, guards /checkout, /orders, /account & /notifications
│   ├── app/
│   │   ├── layout.tsx                       # root: fonts, theme + React Aria router providers, toaster, SEO metadata
│   │   ├── robots.ts, sitemap.ts            # /robots.txt + /sitemap.xml from Settings → SEO
│   │   ├── (store)/                         # storefront route group (header / footer shell in layout.tsx)
│   │   │   ├── page.tsx                     # home: hero, categories, featured products
│   │   │   ├── shop/page.tsx                # catalog (?category=slug&q=search)
│   │   │   ├── products/[slug]/             # product detail + purchase panel
│   │   │   ├── [slug]/page.tsx              # published CMS pages (/about-us, /privacy-policy, …)
│   │   │   ├── preview/pages/[id]/          # admin-only draft preview in the storefront layout
│   │   │   ├── cart/page.tsx                # cart (client-side)
│   │   │   ├── checkout/{page.tsx,actions.ts}  # checkout form + placeOrder server action
│   │   │   ├── orders/                      # order history + order detail / confirmation
│   │   │   ├── login/, signup/              # auth pages
│   │   │   └── error.tsx, not-found.tsx, template.tsx (page-enter animation)
│   │   ├── auth/actions.ts                  # signIn / signUp / signOut / signInWithGoogle server actions
│   │   ├── auth/callback/route.ts           # e-mail confirmation + OAuth (PKCE code exchange)
│   │   ├── api/orders/[id]/chat/            # order inquiries: GET / POST the thread, stream/ = SSE feed, receipt/ = ✓/✓✓
│   │   ├── api/presence/ping/route.ts       # the 25 s heartbeat behind "Online" / "Last seen …"
│   │   ├── nemesis/                         # admin: layout (sidebar shell + requireAdmin), actions.ts,
│   │   │                                    #   dashboard, pages/ (+ actions.ts), products/, categories/, orders/, users/, media/, settings/,
│   │   │                                    #   template.tsx (content-only page-enter animation – keeps the fixed sidebar out of it)
│   │   └── globals.css                      # Tailwind v4 + shadcn theme tokens (light / dark)
│   ├── components/
│   │   ├── ui/                              # shadcn/ui (React Aria base) – generated, edit freely
│   │   ├── admin/                           # dashboard: app-sidebar, admin-header, forms, list toolbar …
│   │   │   ├── media/                       # Media Library UI + the reusable picker / media-ref-field
│   │   │   ├── pages/                       # page form, Tiptap rich-text editor, tag input, SEO panel, status select
│   │   │   ├── menu/                        # Extra → Menu: location switch, add panel, item table, edit dialog
│   │   │   ├── users/                       # Users → New user: the create-account dialog (generate / reveal / copy password)
│   │   │   ├── home/                        # Extra → Home page: section switches + filter title form
│   │   │   └── extra/                       # Extra → Theme Customization: colour fields (HEX/RGB/HSL), gradients, presets
│   │   ├── notifications/                    # NotificationBell + live provider (shared by both headers),
│   │   │                                     #   the board for /notifications and /nemesis/notifications, rows, mutations
│   │   ├── order-chat/order-chat.tsx        # the inquiry thread (same component on the customer + admin order page)
│   │   ├── page-article.tsx                 # storefront template for CMS pages (also used by the admin preview)
│   │   ├── data-grid.tsx, page-breadcrumbs.tsx  # client wrappers around the React Aria Table (selection, bulk bar, dnd-kit row reordering) / Breadcrumbs
│   │   ├── home-product-filter.tsx          # home page: client-side category pills + product grid + pager (UI → Home page)
│   │   ├── product-pagination.tsx           # storefront pager (links on /shop, in-place pages on the home filter)
│   │   └── header.tsx, footer.tsx, nav-link.tsx, mobile-nav.tsx, user-menu.tsx, cart-*.tsx, product-*.tsx, checkout-form.tsx …
│   ├── hooks/use-mobile.ts
│   └── lib/
│       ├── admin/{auth,data,form,list-params,pagination,constants}.ts
│       ├── pages/{shared,sanitize}.ts       # slug rules, SEO helpers, HTML sanitiser for page content
│       ├── media/{shared,server}.ts         # media URLs / renditions, upload validation
│       ├── site-settings.ts, menu.ts        # cached store settings / header + footer menus (tag-invalidated)
│       ├── home-sections.ts                 # home-page section ids, labels and the filter-title limit (shared by admin + storefront)
│       ├── order-chat.ts, order-chat-bus.ts, order-messages.ts  # chat rules (statuses, turn, 200 chars), SSE fan-out, queries + receipts
│       ├── presence.ts, presence.server.ts  # online window / idle window / visibility modes (shared) and store_presence_for() / profile reads
│       ├── notifications.ts, notifications.server.ts, notification-bus.ts  # kinds / filters / labels, queries, SSE fan-out
│       ├── catalog.ts, pagination.ts        # PRODUCTS_PER_PAGE, /shop URL builder, count label / page arithmetic shared with the admin
│       ├── menu-config.ts                   # menu locations, URL rules, href resolution (shared by storefront, admin and actions)
│       ├── seo.ts                           # metadata, robots/sitemap entries, JSON-LD built from the SEO tab
│       ├── image-hosts.ts                   # next/image allow-list
│       ├── supabase/{server,proxy,service}.ts  # Supabase clients (server components / actions, proxy, service-role for the Admin API)
│       ├── password.ts                      # password rules, the generator and the strength meter (shared)
│       ├── auth.ts                          # getCurrentUser() – verified via getClaims()
│       ├── data/{products,orders,pages}.ts  # data-access layer (cached, tag-invalidated)
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
                       └──1:N──▶ order_messages (inquiry thread: customer ⇄ admin, immutable)
media_folders ──1:N──▶ media ◀──N:M──▶ products (product_media = gallery, products.image_media_id = main image)
profiles ──1:N──▶ pages ◀──N:M──▶ tags (page_tags)   pages ◀──N:M──▶ media (page_media = images in the content; featured_image_id / og_image_id)
```

- Prices are stored as **integer USD micro-dollars** (`price_micros`, `bigint`) – exact whole numbers, no floating-point rounding, and fine enough that a taka amount typed in the admin survives the round trip unchanged. The display currency (USD or BDT × `usd_to_bdt_rate`) is a `site_settings` option; orders snapshot `currency` + `exchange_rate` (`src/lib/money.ts` holds the conversion / formatting helpers).
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
| Store name | `.env.local` → `NEXT_PUBLIC_STORE_NAME` (fallback – the dashboard setting wins) |
| Currency (USD / BDT) + USD→BDT exchange rate | `/nemesis/settings` → **WooCommerce** → *Currency* (`site_settings.currency` / `usd_to_bdt_rate`; amounts are stored in USD micro-dollars and converted for display) |
| Shipping rules | `src/lib/config.ts` **and** `calculate_shipping()` in the migration (keep in sync) |
| Max quantity per line | `src/lib/config.ts` → `MAX_QTY_PER_LINE` |
| Store name / tagline / contact links / favicon | `/nemesis/settings` → **General** (stored in `site_settings`; `NEXT_PUBLIC_STORE_NAME` is only the fallback) |
| Search engine visibility, meta description, share image, verification codes, sitemap | `/nemesis/settings` → **SEO** (`/robots.txt` and `/sitemap.xml` are generated from it) |
| Stock management on/off | `/nemesis/settings` → **WooCommerce** (global; `public.stock_managed()` in SQL) |
| Header / footer navigation links | `/nemesis/ui` → **Menu** (`menu_items`; the storefront never hard-codes a link) |
| Home page sections (category tiles, featured products, filtered product list + its title) | `/nemesis/ui?tab=home` → **Home page** (`site_settings.home_*`) |
| Products per page on `/shop` and in the home-page filter | `src/lib/catalog.ts` → `PRODUCTS_PER_PAGE` (12). `/shop` paginates with `?page=` (page 1 has no parameter, a page past the end redirects to the last one, every page is self-canonical); the home-page filter pages the products already on the page |
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
- [x] **Currency** – USD / BDT selector with a USD→BDT rate; converted prices everywhere, base prices untouched, orders stamped with their rate
- [x] **Product images in Supabase Storage** with an upload UI
- [x] **Media Library** – uploads, folders, trash, optimisation / WebP, image editor, alt text, usage tracking, reusable picker
- [x] **Single `media` bucket** – favicon / share image picked from the library, one-click import of the legacy `product-images` / `site-media` buckets
- [x] **Pages** – rich-text content pages at `/<slug>` with drafts, preview, tags, featured image and per-page SEO
- [x] **Order inquiries** – turn-based customer ⇄ admin chat on the order pages, live over Server-Sent Events (pending & cancelled orders), with **presence** (Online / Last seen / Offline, per-customer visibility + a global fallback, real presence only – an idle or closed tab is never "Online") and **read receipts** (✓ / ✓✓, masked to *Delivered* for the customer until the admin answers)
- [x] **Notifications** – a bell in both headers and a page for each role, fed by one SSE connection per tab (order status, new orders, payments, inquiries; bulk mark-read / delete)
- [x] **Create users from the dashboard** – Users → *New user*: name, e-mail, phone, role and a generated / revealed / copyable password
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
