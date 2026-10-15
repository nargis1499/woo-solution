import type { Metadata } from "next";
import { adminGetSiteSettings } from "@/lib/admin/data";
import { formatDate } from "@/lib/format";
import { STORE_NAME } from "@/lib/config";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader, Section } from "@/components/admin/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Kbd } from "@/components/ui/kbd";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const settings = await adminGetSiteSettings();

  return (
    <>
      <PageHeader title="Settings" description="Branding shown across the storefront." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="Site identity">
          {settings ? (
            <SettingsForm settings={{ store_name: settings.store_name, tagline: settings.tagline, support_email: settings.support_email }} />
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Settings table missing</AlertTitle>
              <AlertDescription>The site_settings row is missing. Run supabase/migrations/20261016000000_admin.sql in the Supabase SQL Editor.</AlertDescription>
            </Alert>
          )}
        </Section>
        <Section title="Good to know">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li>Changes go live immediately – no redeploy needed.</li>
            <li>
              The fallback title when nothing is saved is <Kbd>{STORE_NAME}</Kbd> from <Kbd>NEXT_PUBLIC_STORE_NAME</Kbd>.
            </li>
            <li>
              Press <Kbd>⌘</Kbd> <Kbd>B</Kbd> to collapse the sidebar.
            </li>
            {settings?.updated_at && <li>Last saved {formatDate(settings.updated_at)}.</li>}
          </ul>
        </Section>
      </div>
    </>
  );
}
