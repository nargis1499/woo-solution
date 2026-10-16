-- =============================================================================
--  Woo Solution – theme customization
--
--  Extra → Theme Customization stores its palette on the single `site_settings`
--  row so the storefront (and the dashboard) restyle themselves on the next
--  request – no rebuild, no extra table to join:
--
--    theme_light     { primary, secondary, button, button_hover, loader }  (null = template default)
--    theme_dark      the same five keys for dark mode
--    theme_gradients { button: {...}, loader: {...}, hero: {...} }
--    theme_sync      true = dark mode reuses the light palette
--
--  Colours are stored exactly as the admin typed them (hex / rgb() / hsl()) –
--  the app validates them (src/lib/theme.ts) before writing, and simply omits
--  a key the admin never touched so the template keeps its own value.
-- =============================================================================

alter table public.site_settings
  add column if not exists theme_light     jsonb   not null default '{}'::jsonb,
  add column if not exists theme_dark      jsonb   not null default '{}'::jsonb,
  add column if not exists theme_gradients jsonb   not null default '{}'::jsonb,
  add column if not exists theme_sync      boolean not null default false;

comment on column public.site_settings.theme_light is
  'Extra → Theme Customization: light-mode overrides {primary, secondary, button, button_hover, loader}';
comment on column public.site_settings.theme_dark is
  'Extra → Theme Customization: dark-mode overrides (same keys as theme_light)';
comment on column public.site_settings.theme_gradients is
  'Extra → Theme Customization: gradients for {button, loader, hero}';

notify pgrst, 'reload schema';
