"use client";

import { useState } from "react";
import type { Key } from "react-aria-components";
import { SETTINGS_TABS, type SettingsTabId } from "@/lib/admin/settings-tabs";
import type { SiteSettings } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsForm, SeoSettingsForm, ShopSettingsForm } from "./settings-forms";

export function SettingsTabs({ settings, initialTab = "general" }: { settings: SiteSettings; initialTab?: SettingsTabId }) {
  const [tab, setTab] = useState<Key>(initialTab);

  function select(key: Key) {
    setTab(key);
    // Keep the tab in the URL (shareable / survives reload) without a server round-trip.
    const url = key === "general" ? "/nemesis/settings" : `/nemesis/settings?tab=${String(key)}`;
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={select} className="gap-5">
      <TabsList aria-label="Settings sections" className="h-auto max-w-full overflow-x-auto">
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
