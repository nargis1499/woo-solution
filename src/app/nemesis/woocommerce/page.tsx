import type { Metadata } from "next";
import { adminGetSiteSettings } from "@/lib/admin/data";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/admin/ui";
import { WoocommerceTabs } from "@/components/admin/woocommerce-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = { title: "WooCommerce" };

export default async function AdminWoocommercePage() {
  const settings = await adminGetSiteSettings();

  return (
    <>
      <PageHeader
        title="WooCommerce"
        description={
          settings?.updated_at
            ? `Last saved ${formatDate(settings.updated_at)}.`
            : "Stock management, currency and shipping options – changes go live immediately."
        }
      />
      {settings ? (
        <div className="space-y-5">
          {!settings.migrated && (
            <Alert variant="destructive">
              <AlertTitle>Database update required</AlertTitle>
              <AlertDescription>
                Run supabase/migrations/20261018000000_settings_tabs.sql in the Supabase SQL Editor to enable WooCommerce options.
              </AlertDescription>
            </Alert>
          )}
          <WoocommerceTabs
            settings={settings}
            currencyMigrated={settings.currencyMigrated}
          />
        </div>
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Settings table missing</AlertTitle>
          <AlertDescription>
            The site_settings row is missing. Run supabase/migrations/20261016000000_admin.sql in the Supabase SQL Editor.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
