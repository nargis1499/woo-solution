"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Key } from "react-aria-components";
import { isSettingsTab, SETTINGS_TABS, type SettingsTabId } from "@/lib/admin/settings-tabs";
import type { SiteSettings } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsForm, SeoSettingsForm, ShopSettingsForm } from "./settings-forms";

export function SettingsTabs({ settings }: { settings: SiteSettings }) {
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
        <GeneralSettingsForm settings={settings} />
      </TabsContent>
      <TabsContent id="seo" shouldForceMount className="data-inert:hidden">
        <SeoSettingsForm settings={settings} />
      </TabsContent>
      <TabsContent id="woocommerce" shouldForceMount className="data-inert:hidden">
        <ShopSettingsForm settings={settings} />
      </TabsContent>
    </Tabs>
  );
}
