"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Key } from "react-aria-components";
import { isSettingsTab, SETTINGS_TABS, type SettingsTabId } from "@/lib/admin/settings-tabs";
import type { SettingsMedia, SiteSettings } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsForm, SeoSettingsForm, ShopSettingsForm } from "./settings-forms";
import { PresenceVisibilityCard } from "./presence-visibility";
import type { PresenceVisibility } from "@/lib/presence";

export function SettingsTabs({
  settings,
  media,
  currencyMigrated = true,
  presenceVisibility,
}: {
  settings: SiteSettings;
  media: SettingsMedia;
  currencyMigrated?: boolean;
  /** The global fallback of the admin's online visibility (Presence card). */
  presenceVisibility: PresenceVisibility;
}) {
  // The URL is the source of truth (?tab=seo …): it is shareable, survives a reload, and when Next.js
  // restores this page after navigating away the tabs follow the link that was clicked.
  const param = useSearchParams().get("tab") ?? undefined;
  const urlTab: SettingsTabId = isSettingsTab(param) ? param : "general";
  const [tab, setTab] = useState<Key>(urlTab);
  const [seenUrlTab, setSeenUrlTab] = useState<SettingsTabId>(urlTab);
  if (seenUrlTab !== urlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }

  function select(key: Key) {
    setTab(key);
    // Keep the tab in the URL without a server round-trip. Next.js syncs useSearchParams with this call
    // only when it is not handed its own history state back (that path is reserved for its internals).
    const url = key === "general" ? "/nemesis/settings" : `/nemesis/settings?tab=${String(key)}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={select} className="gap-5">
      {/* wraps instead of scrolling – an overflow container showed scrollbar arrows next to the tabs on Windows */}
      <TabsList aria-label="Settings sections" className="h-auto max-w-full flex-wrap">
        {SETTINGS_TABS.map((t) => (
          <TabsTrigger key={t.id} id={t.id} className="px-3 py-1.5">
            <t.icon /> {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* shouldForceMount keeps every form mounted, so unsaved edits survive switching tabs */}
      <TabsContent id="general" shouldForceMount className="data-inert:hidden">
        <div className="space-y-5">
          <GeneralSettingsForm settings={settings} favicon={media.favicon} />
          <PresenceVisibilityCard value={presenceVisibility} />
        </div>
      </TabsContent>
      <TabsContent id="seo" shouldForceMount className="data-inert:hidden">
        <SeoSettingsForm settings={settings} shareImage={media.share_image} />
      </TabsContent>
      <TabsContent id="woocommerce" shouldForceMount className="space-y-5 data-inert:hidden">
        {!currencyMigrated && (
          <Alert variant="destructive">
            <AlertTitle>Database update required</AlertTitle>
            <AlertDescription>Run supabase/migrations/20261025000000_currency.sql in the Supabase SQL Editor to enable the currency options.</AlertDescription>
          </Alert>
        )}
        <ShopSettingsForm settings={settings} />
      </TabsContent>
    </Tabs>
  );
}
