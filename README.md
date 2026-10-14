# Woo Solution

A WooCommerce-style storefront built with **Next.js 16** (App Router, Cache Components) and **Supabase** (Postgres + Auth).

**MVP scope** – customers can browse a product catalog, sign up / sign in, add items to a cart, check out with cash on delivery, and view their order history.

| Area | What's included |
| --- | --- |
| Catalog | Home page with categories & featured products, `/shop` with category filter + search, product detail pages with related products |
| Cart | Guest-friendly cart persisted in `localStorage` (Zustand), quantity controls, stock limits, shipping preview |
| Auth | E-mail + password **and "Continue with Google"** (Supabase Auth, PKCE flow), sign out, protected routes, open-redirect-safe `?next=` handling |
| Checkout | Shipping form → atomic `place_order()` Postgres function (prices re-read from DB, stock locked & decremented, order number generated) |
| Orders | `/orders` history and `/orders/[id]` confirmation page, protected by Row Level Security |
| Security | RLS on every table, `SECURITY DEFINER` checkout RPC only executable by `authenticated`, JWT verified with `getClaims()` |

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
3. Paste [`supabase/seed.sql`](supabase/seed.sql) and run it to load the 12 demo products.

> Using the Supabase CLI instead? `supabase link --project-ref <ref> && supabase db push`, then run the seed file with `supabase db query -f supabase/seed.sql` (or paste it in the SQL editor).

### Configure environment variables

Open `.env.local` and fill in the values from **Project Settings → API** (or the *Connect* dialog):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # legacy "anon" key also works
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_STORE_NAME=Woo Solution
NEXT_PUBLIC_CURRENCY=USD
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

---

## 2. Project structure

```
woo-solution/
├── supabase/
│   ├── migrations/20261014000000_init.sql   # schema, RLS, triggers, place_order() RPC
│   └── seed.sql                             # demo categories + products
├── src/
│   ├── proxy.ts                             # refreshes the Supabase session, guards /checkout & /orders
│   ├── app/
│   │   ├── layout.tsx                       # header / footer shell
│   │   ├── page.tsx                         # home: hero, categories, featured products
│   │   ├── shop/page.tsx                    # catalog (?category=slug&q=search)
│   │   ├── products/[slug]/                 # product detail + purchase panel
│   │   ├── cart/page.tsx                    # cart (client-side)
│   │   ├── checkout/{page.tsx,actions.ts}   # checkout form + placeOrder server action
│   │   ├── orders/                          # order history + order detail / confirmation
│   │   ├── login/, signup/                  # auth pages
│   │   ├── auth/actions.ts                  # signIn / signUp / signOut server actions
│   │   ├── auth/callback/route.ts           # e-mail confirmation (PKCE code exchange)
│   │   ├── error.tsx, not-found.tsx
│   │   └── globals.css                      # Tailwind v4 theme (brand palette)
│   ├── components/                          # UI: header, product card, cart view, checkout form …
│   └── lib/
│       ├── supabase/{client,server,proxy}.ts# Supabase clients (browser / server / proxy)
│       ├── auth.ts                          # getCurrentUser() – verified via getClaims()
│       ├── data/{products,orders}.ts        # data-access layer
│       ├── cart-store.ts                    # Zustand cart (persisted)
│       ├── config.ts                        # store name, currency, shipping rules
│       ├── format.ts, types.ts, utils.ts
└── .github/workflows/ci.yml                 # lint + type-check + build on every push

Google sign-in lives in `src/app/auth/actions.ts` (`signInWithGoogle`), `src/components/google-button.tsx` and `src/app/auth/callback/route.ts`.
```

### Database schema

```
auth.users ──1:1──▶ profiles (auto-created by trigger)
categories ──1:N──▶ products
auth.users ──1:N──▶ orders ──1:N──▶ order_items (price & name snapshotted at purchase)
```

- Prices are stored as **integer cents** (`price_cents`) – no floating-point rounding.
- `place_order(p_items jsonb, p_shipping jsonb)` runs the whole checkout in one transaction:
  validates auth + input → inserts the order → locks each product row (`FOR UPDATE`) → checks & decrements stock → snapshots items → computes shipping (`calculate_shipping`) → returns the order id. Any failure rolls everything back and surfaces a friendly message (e.g. *"Only 2 left in stock for "Everyday Hoodie"."*).
- Row Level Security: products/categories are readable by everyone (active products only); orders and order items are readable **only by their owner**; nobody can insert/update orders directly from the client.

### Rendering model

The project uses Next.js 16's **Cache Components** (`cacheComponents: true`). Every page ships a static shell instantly; anything that reads the session or the database lives behind a `<Suspense>` boundary and streams in. `src/lib/supabase/server.ts` calls `connection()` so Supabase work always happens at request time.

---

## 3. Configuration

| What | Where |
| --- | --- |
| Store name / currency | `.env.local` → `NEXT_PUBLIC_STORE_NAME`, `NEXT_PUBLIC_CURRENCY` (also update `orders.currency` default in the migration if you change currency) |
| Shipping rules | `src/lib/config.ts` **and** `calculate_shipping()` in the migration (keep in sync) |
| Max quantity per line | `src/lib/config.ts` → `MAX_QTY_PER_LINE` |
| Products / categories | Supabase dashboard → Table Editor (or SQL). Set `is_active = false` to hide a product, `is_featured = true` to show it on the home page |
| Product images | Any public URL. For Supabase Storage, upload to a public bucket and paste the URL – `*.supabase.co` is already allowed in `next.config.ts` |
| Order status | Update `orders.status` (`pending` → `processing` → `completed` / `cancelled`) and `payment_status` in the dashboard – a proper admin UI is on the roadmap |

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
- [ ] **Admin dashboard** – manage products, categories, stock and order statuses (`is_admin` flag on `profiles` + RLS policies)
- [ ] **Product images in Supabase Storage** with an upload UI
- [ ] **Server-side cart** (`cart_items` table) synced across devices, merged on login
- [ ] **Coupons & discounts**, tax rules, multiple shipping methods
- [ ] **Transactional e-mails** (order confirmation) via Resend / Supabase Edge Functions
- [ ] **Account page** – edit profile, saved addresses, password reset
- [ ] More social providers (GitHub, Facebook, Apple) – same pattern as Google, one `provider` string away
- [ ] Product variants (size / colour), reviews, wishlists

---

## License

MIT
