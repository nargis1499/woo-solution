import type { Metadata } from "next";
import { adminListCategories, adminListMenuItems, adminListPageOptions, isMissingMenuSchema, type PageOption } from "@/lib/admin/data";
import { isMenuLocation } from "@/lib/menu-config";
import type { Category, MenuItem } from "@/lib/types";
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
  try {
    [items, pages, categories] = await Promise.all([adminListMenuItems(location), adminListPageOptions(), adminListCategories()]);
  } catch (e) {
    if (!isMissingMenuSchema(e)) throw e;
    missingSchema = true;
  }

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
        }}
      />
    </>
  );
}
