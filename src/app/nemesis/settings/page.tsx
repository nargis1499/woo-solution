import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminGetSiteSettings } from "@/lib/admin/data";
import { getAdminStatus } from "@/lib/admin/auth";
import { adminGetAiSettings } from "@/lib/ai/settings";
import { getPresenceVisibility } from "@/lib/presence.server";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/admin/ui";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Settings" };

type SearchParams = Promise<{ tab?: string }>;

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  if (params.tab === "woocommerce" || params.tab === "ecommerce") {
    redirect("/nemesis/ecommerce");
  }

  const [settings, ai, { user }] = await Promise.all([
    adminGetSiteSettings(),
    adminGetAiSettings(),
    getAdminStatus(),
  ]);
  const presenceVisibility = user ? await getPresenceVisibility(user.id) : "online";

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          settings?.updated_at
            ? `Last saved ${formatDate(settings.updated_at)}.`
            : "Branding, SEO and AI options – changes go live immediately."
        }
      />
      {settings ? (
        <div className="space-y-5">
          {!settings.migrated && (
            <Alert variant="destructive">
              <AlertTitle>Database update required</AlertTitle>
              <AlertDescription>
                Run supabase/migrations/20261018000000_settings_tabs.sql in the Supabase SQL Editor to enable the General and SEO options.
              </AlertDescription>
            </Alert>
          )}
          <SettingsTabs
            settings={settings}
            media={settings.media}
            presenceVisibility={presenceVisibility}
            aiSettings={ai.client}
            aiMigrated={ai.migrated}
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
