import { TypographyEditor } from "@/components/admin/typography/typography-editor";
import { saveTypography } from "./typography-actions";
import { DEFAULT_TYPOGRAPHY } from "@/lib/typography/catalog";
import type { Metadata } from "next";
import { adminGetSiteSettings, adminListCategories, adminListMenuItems, adminListPageOptions, isMissingMenuSchema, type PageOption } from "@/lib/admin/data";
import { isMenuLocation } from "@/lib/menu-config";
import type { Category, MenuItem } from "@/lib/types";
import { HomeSectionsForm } from "@/components/admin/home/home-sections-form";
import { ThemeEditor } from "@/components/admin/extra/theme-editor";
import { MenuEditor } from "@/components/admin/menu/menu-editor";
import { PageHeader } from "@/components/admin/ui";
import { UiTabs } from "@/components/admin/ui-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DEFAULT_THEME } from "@/lib/theme";

export const metadata: Metadata = { title: "UI" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminUiPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const locationParam = Array.isArray(params.location) ? params.location[0] : params.location;
  const location = isMenuLocation(locationParam) ? locationParam : "header";

  let items: MenuItem[] = [];
  let pages: PageOption[] = [];
  let categories: Category[] = [];
  let missingSchema = false;
  const [menuData, settings] = await Promise.all([
    Promise.all([adminListMenuItems(location), adminListPageOptions(), adminListCategories()]).catch((e: unknown) => {
      if (!isMissingMenuSchema(e)) throw e;
      return null;
    }),
    adminGetSiteSettings(),
  ]);
  if (menuData) [items, pages, categories] = menuData;
  else missingSchema = true;

  // Colors → Colors & Gradients: the palette lives on the settings row; without the row
  // (settings migration not run) the editor still opens on the template defaults.
  const theme = settings
    ? { light: settings.theme_light, dark: settings.theme_dark, gradients: settings.theme_gradients, sync: settings.theme_sync }
    : DEFAULT_THEME;

  return (
    <>
      <PageHeader title="UI" description="How the storefront looks and navigates. Changes go live immediately." />
      <UiTabs
        panels={{
          menu: missingSchema ? (
            <Alert variant="destructive">
              <AlertTitle>Database update required</AlertTitle>
              <AlertDescription>Run supabase/migrations/20261023000000_menus.sql in the Supabase SQL Editor to manage the header and footer menus here.</AlertDescription>
            </Alert>
          ) : (
            <MenuEditor location={location} items={items} pages={pages} categories={categories} />
          ),
          home: (
            <div className="space-y-5">
              {settings && !settings.homeMigrated && (
                <Alert variant="destructive">
                  <AlertTitle>Database update required</AlertTitle>
                  <AlertDescription>Run supabase/migrations/20261024000000_home_sections.sql in the Supabase SQL Editor to switch home page sections on and off.</AlertDescription>
                </Alert>
              )}
              {settings ? (
                <HomeSectionsForm settings={settings} categories={categories} />
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Settings table missing</AlertTitle>
                  <AlertDescription>The site_settings row is missing. Run supabase/migrations/20261016000000_admin.sql in the Supabase SQL Editor.</AlertDescription>
                </Alert>
              )}
            </div>
          ),
          typography: <TypographyEditor saved={settings?.typography ?? DEFAULT_TYPOGRAPHY} available={settings?.typographyMigrated ?? false} saveAction={saveTypography} />,
          colors: <ThemeEditor saved={theme} />,
          extra: (
            <section aria-labelledby="extra-settings-title" className="rounded-xl border bg-card p-6">
              <h2 id="extra-settings-title" className="text-xl font-bold tracking-tight">Extra</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Reserved for future UI settings. There are no additional settings here yet.
              </p>
            </section>
          ),
        }}
      />
    </>
  );
}
