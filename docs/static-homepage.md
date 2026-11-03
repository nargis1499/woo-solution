# Published page as homepage

Go to **UI → Home page → Homepage**, choose **Default storefront** or a published
CMS page, and click the single **Save changes** button. Selecting **Default
storefront** shows its section editor; selecting a static page hides it. Saving
the default writes the assignment and section settings atomically in one update.
Saving a static page changes only the assignment, preserving fallback sections,
colors, typography and other settings. Section drafts stay mounted when switching
between choices, but hidden controls are disabled and excluded from static saves.

## Rendering and failure behavior

- `site_settings.home_page_id` is a nullable UUID foreign key. NULL means the
  existing storefront. Stable IDs allow the chosen page's slug to change.
- Only published pages can be selected through the admin-checked server action.
  Public reads additionally filter by published status and retain existing RLS.
- The selected page renders server-side directly at `/`, through the existing
  sanitized PageArticle renderer and its supported content/product blocks.
- Page-linked header/footer menu items point straight to `/` without a redirect.
- Its original `/<slug>` uses a temporary redirect to `/`, avoiding duplicate
  content without permanently caching a homepage assignment that may change.
- Unpublishing the page immediately uses the built-in homepage; republishing it
  restores its selection. Deletion clears the foreign key. Failed page lookups
  fall back without caching the transient failure as a missing page.

## SEO

The homepage uses the page's SEO title, excerpt/description, Open Graph title,
description, share image and indexing/follow preferences, respecting the global
search-visibility switch. It uses website Open Graph type. Its canonical URL,
Open Graph URL and WebPage JSON-LD URL point at `/` (overriding any old custom
canonical on the promoted page). The original slug redirects rather than exposing
a second indexable copy. Returning to the built-in homepage restores site SEO.
The normal CMS title is the single H1; content H1s are demoted as before.

The sitemap includes the homepage once, with the selected page's modification
time. It omits the selected page's original slug and omits the homepage entry if
the selected page is noindex. Page edits/publish/unpublish/delete use the existing
page and sitemap invalidation; assignment changes invalidate settings and the
storefront router cache too.

## Performance and deployment

No new client-side content fetch or homepage-only JavaScript is introduced. The
default storefront adds no page query. A static homepage uses one indexed ID lookup
on cache miss, cached for an hour and invalidated on page writes. React request
memoization shares that lookup between HTML and metadata. Selecting a static page
returns before the default storefront's product/category section rendering starts.
Images and interactive content reuse the existing page renderer. Actual load time
still depends on the size/images/blocks placed in the selected page.

Apply `supabase/migrations/20261060000000_static_homepage.sql` before enabling the
selector. It is additive, starts with NULL/default for all existing settings and
does not assign or alter a page. The content-specific foreign key is intentionally
not copied to new empty client setups. Settings and sitemap cache keys are versioned
to avoid old cached payloads surviving deployment with the previous schema.

No tests or test suites were run for this update, following the user's instruction.
Verification is limited to TypeScript, lint, build and code/schema review; an
authenticated end-to-end homepage save, page lifecycle and browser SEO/performance
smoke check remain deployment checks. No live homepage assignment was changed.

## Homepage picker interface

The homepage selector reuses the dashboard's accessible, themed combobox rather
than the operating system's native dropdown. Search matches page names and URLs;
options show a page icon, separate address, published badge and selected checkmark.
The default storefront remains a first-class option. A selection summary shows
what will appear at `/`, and one Save button applies the selection and default
storefront settings. The homepage ID comes from the selected option through a
hidden form field, never from freeform search text.

`artifacts/homepage-picker-desktop.png` shows the earlier picker-only layout in an
isolated local desktop preview with sample page labels. No live homepage setting was
changed; the temporary preview route was removed. No tests or test suites were
run for this visual refinement.

## Unified save and dashboard synchronization

The Home page tab now has one parent form and one sticky **Save changes** button.
The picker is controlled by that parent, not a separate action/state container.
The server response acknowledges the committed homepage ID; the client immediately
updates its selection and saved baseline, then calls `router.refresh()` to refresh
server props without a full reload. Fresh server settings are synchronized without
discarding an unsaved local selection. Failed saves retain drafts and display the
shared error rather than marking them saved.

The same server action validates published pages, writes default settings and the
homepage assignment in a single settings update, and invalidates settings, menu,
sitemap and router caches. Legacy assignment-only and section-only callers retain
their existing behavior. No schema or SEO changes were needed. No tests or screenshot
captures were run for this fix, as requested.
