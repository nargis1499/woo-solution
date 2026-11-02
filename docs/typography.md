# Store & Admin typography

Open **UI → Typography** (`/nemesis/ui?tab=typography`). Each scope has independent
Title, Body and Button selectors, a searchable 23-family catalog, and live previews.
Changes and resets are local until **Save changes**. Unsaved drafts are kept in the
current browser tab; reload/close and link navigation are guarded. Draft recovery
keeps local edited scopes while preserving newer saved values for untouched scopes.

## Defaults and persistence

- Store: Plus Jakarta Sans / Inter / Inter.
- Admin: Inter / Inter / Inter.
- Existing `site_settings.typography` JSONB is normalized per role; missing/invalid
  values use defaults without writing over existing settings. No new settings table.
- `20261059000000_typography.sql` adds the nullable column, strict shape/font-name
  CHECK, and admin-checked SECURITY INVOKER RPC. Existing UPDATE RLS remains in force;
  anonymous callers cannot execute the RPC. Partial-scope atomic merges prevent a
  Store save from replacing a concurrently saved Admin configuration.
- The configuration is registered with the existing client-setup export allowlist.
- The action re-checks admin access and the exact whitelist, bounds the request at
  15 seconds (SQL timeout 10 seconds), checks the returned configuration, invalidates
  the existing settings cache and refreshes layouts. Persistent layouts also receive
  a saved-settings event; changing a dropdown makes no database request.

## Rendering and font delivery

`.store-theme` and `.admin-theme` own `--font-title`, `--font-body`, `--font-button`.
Their SSR styles mirror the active scope's variables onto the root using `:has`,
so portaled dialogs, menus and toasts follow the current layout during navigation.
Previews override variables locally and never change the active Admin configuration
before save. Buttons and button-styled links share the `font-action` utility. Sonner
explicitly uses the body variable instead of its hard-coded system font. Intentional
code/monospace styling is preserved. The global customer 404 also gets Store settings.

Fonts are local, content-hashed WOFF2 with `font-display: swap`. We use runtime-selected
`@font-face`, not dynamic `next/font` calls or an eager 23-font import/preload list:
`next/font` declarations must be statically analyzable while settings are runtime data.
Only used selected faces/weights download, with identical URLs deduplicated by the
browser. The normal selected body face is preloaded through React's deduplicating API;
other weights/faces remain demand-loaded. Picker inspection can load one additional
family on focus/hover. Hashed WOFF2 responses have one-year immutable caching.

See `public/fonts/README.md`, the pinned asset manifest, and
`scripts/vendor-fonts.py` for provenance and regeneration. All 23 licenses ship locally;
21 families use variable faces and Poppins/Lato use supported static application
weights. Assets are normal-style Latin subsets; other scripts use system fallbacks.
No Google or other font CDN requests and no runtime font-package dependency.

## Verification

- `npm run test:ai`: 431 isolated tests (35 typography-specific), covering defaults,
  all 23 families/assets/licenses, whitelist/injection rejection, scope-only saving,
  CSS deduplication/isolation, server action authorization/error handling, and draft
  recovery across concurrent scope changes.
- TypeScript, ESLint and optimized Next production build checked. Build uses placeholder
  public Supabase environment variables, not production authentication credentials.
- Chromium: all 23 fonts successfully loaded; default editor requested only Inter and
  Plus Jakarta Sans. Searching/selecting Lora changed only Store preview, made zero
  POSTs before Save, and restored the draft on reload. At 390px no horizontal overflow;
  no page errors. A cookie-backed mock action additionally verified Save → immediate
  Admin heading update → persisted selectors after reload, with independent scopes.
- Desktop and mobile screenshots: `artifacts/typography-settings.png` and
  `artifacts/typography-mobile.png`. These show the actual editor in an isolated local
  dashboard preview, not an authenticated production session. Temporary preview route
  and browser scripts were removed; no authentication bypass ships.
- The additive migration was applied to the connected database. Metadata verification
  confirmed a validated constraint, SECURITY INVOKER, anonymous execution denied, and
  client-export registration. The live configuration remains NULL/defaults: no live
  font selections were changed. An authenticated production save and full cross-route
  navigation/cache tracing remain deployment smoke checks, not completed live tests.
