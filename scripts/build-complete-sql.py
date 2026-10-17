#!/usr/bin/env python3
"""Regenerate supabase/complete-setup.sql from the migrations + the demo seed.

    python3 scripts/build-complete-sql.py

The output is the file you paste into a brand-new Supabase project's SQL Editor:
every migration in filename order, the API role grants, then the optional demo
catalog. Re-run this after adding a migration and commit the result.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
SEED = ROOT / "supabase" / "seed.sql"
OUT = ROOT / "supabase" / "complete-setup.sql"

# One line per migration for the table of contents inside the file.
TITLES = {
    "20261014000000_init.sql": "1. Core store — profiles, categories, products, orders, order_items, RLS, place_order()",
    "20261015000000_google_auth.sql": "2. Google sign-in — profiles.avatar_url + Google-aware profile trigger",
    "20261016000000_admin.sql": "3. Admin flag, admin RLS, site_settings, admin_stats() / admin_delete_user()",
    "20261017000000_category_menu.sql": "4. categories.show_in_menu (superseded by the menu builder, still needed in order)",
    "20261018000000_settings_tabs.sql": "5. Settings tabs — contact links, favicon, SEO columns, global stock switch",
    "20261019000000_media_library.sql": "6. Media Library — media, folders, galleries, usage helpers + the `media` bucket",
    "20261020000000_single_media_bucket.sql": "7. One bucket for everything — favicon / share image as media references",
    "20261021000000_pages.sql": "8. Pages — pages, tags, page_tags, page_media + RLS",
    "20261022000000_pages_image_urls.sql": "9. External featured / share image URLs for pages",
    "20261023000000_menus.sql": "10. Menus — menu_items for the header / footer navigation",
    "20261024000000_home_sections.sql": "11. Home page section switches + filter title",
    "20261025000000_currency.sql": "12. Currency — USD / BDT + the USD→BDT rate, orders.exchange_rate",
    "20261026000000_money_micros.sql": "13. Money precision — every amount becomes integer USD micro-dollars",
    "20261027000000_variations.sql": "14. Variable products — attributes, variations, place_order() per variation",
    "20261028000000_admin_stats_customers.sql": "15. Dashboard customer counts restored in admin_stats()",
    "20261029000000_theme.sql": "16. Theme customization — palettes, gradients, theme_sync",
    "20261030000000_order_messages.sql": "17. Order inquiries — the per-order chat thread",
    "20261031000000_presence.sql": "18. Presence & receipts — heartbeat, visibility, delivered / seen",
    "20261032000000_order_message_receipts.sql": "19. The narrow UPDATE policy + trigger behind ✓ / ✓✓",
    "20261033000000_customer_visibility.sql": "20. Per-customer visibility + store_presence_for()",
    "20261034000000_notifications.sql": "21. Notifications — the table, RLS and the six order / message triggers",
}

HEADER = """-- =============================================================================
--  Woo Solution — complete database setup (one file)
--
--  HOW TO USE
--   1. Create a new Supabase project.
--   2. Open SQL Editor → New query, paste this WHOLE file, press Run.
--      (It is written for a fresh project; run it once.)
--   3. Project Settings → API: copy the URL, the publishable key and the secret key
--      into the app's .env.local:
--         NEXT_PUBLIC_SUPABASE_URL=…
--         NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=…
--         SUPABASE_SERVICE_ROLE_KEY=…      (server only — needed by Users → New user)
--   4. Sign up in the app once, then make yourself admin:
--         update public.profiles set is_admin = true where email = 'you@example.com';
--      Everything (dashboard, order chat, notifications, media, pages …) works from there.
--
--  WHAT IS IN HERE
--   • All 21 migrations in order — schema, RLS, triggers, functions, storage bucket.
--   • API role grants (Supabase normally sets these up; stated here so the file is
--     self-contained).
--   • OPTIONAL demo catalog at the very end (categories + products + header menu).
--     Delete that last section if you want an empty store.
--
--  Storage: the `media` bucket is created here. Nothing else has to be configured.
--  Auth: e-mail sign-up works out of the box; Google needs the provider set up in
--  Authentication → Providers (see the README).
-- =============================================================================

"""

GUARD = """
-- This file is meant for a NEW project. If the schema is already there, stop with a
-- readable message instead of failing halfway through a table that exists.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles') then
    raise exception 'This database already has the Woo Solution schema (public.profiles exists). Run this file only once, on a fresh Supabase project.';
  end if;
end
$$;

"""

GRANTS = """

-- =============================================================================
--  API role grants
--  Supabase grants these to its API roles automatically for objects created in
--  the public schema; repeated here so this file does not depend on that.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
"""

SEED_HEADER = """

-- =============================================================================
--  OPTIONAL — demo catalog (4 categories, 12 products, header menu).
--  Delete everything from this line to the end of the file for an empty store.
-- =============================================================================

"""


def main() -> None:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise SystemExit(f"no migrations found in {MIGRATIONS}")

    parts = [HEADER, GUARD]
    for path in files:
        title = TITLES.get(path.name, path.name)
        parts.append("\n-- " + "=" * 77 + "\n")
        parts.append(f"-- {title}\n")
        parts.append(f"-- (migration {path.name})\n")
        parts.append("-- " + "=" * 77 + "\n\n")
        parts.append(path.read_text().rstrip() + "\n")

    parts.append(GRANTS)
    parts.append(SEED_HEADER + SEED.read_text().rstrip() + "\n")

    text = "".join(parts)
    OUT.write_text(text)
    print(f"{OUT.relative_to(ROOT)}  —  {len(files)} migrations, {len(text.splitlines())} lines, {len(text):,} bytes")


if __name__ == "__main__":
    main()
