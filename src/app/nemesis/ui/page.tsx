import type { Metadata } from "next";
import { adminGetSiteSettings, adminListCategories, adminListMenuItems, adminListPageOptions, isMissingMenuSchema, type PageOption } from "@/lib/admin/data";
import { isMenuLocation } from "@/lib/menu-config";
import type { Category, MenuItem } from "@/lib/types";
import { HomeSectionsForm } from "@/components/admin/home/home-sections-form";
import { MenuEditor } from "@/components/admin/menu/menu-editor";
import { PageHeader } from "@/components/admin/ui";
import { UiTabs } from "@/components/admin/ui-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = { title: "UI" };

type SearchParams = Promise<{ tab?: string; location?: string }>;

export default async function AdminUiPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const location = isMenuLocation(params.location) ? params.location : "header";

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
                <HomeSectionsForm settings={settings} />
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Settings table missing</AlertTitle>
                  <AlertDescription>The site_settings row is missing. Run supabase/migrations/20261016000000_admin.sql in the Supabase SQL Editor.</AlertDescription>
                </Alert>
              )}
            </div>
          ),
        }}
      />
    </>
  );
}
