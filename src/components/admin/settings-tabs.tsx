"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SaveIcon } from "lucide-react";
import type { Key } from "react-aria-components";
import { isSettingsTab, SETTINGS_TABS, type SettingsTabId } from "@/lib/admin/settings-tabs";
import type { PublicAiSettings } from "@/lib/ai/providers";
import type { SettingsMedia, SiteSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsForm, SeoSettingsForm } from "./settings-forms";
import { PresenceVisibilityCard } from "./presence-visibility";
import { AiSettingsForm } from "./ai/ai-settings-form";
import type { PresenceVisibility } from "@/lib/presence";

export function SettingsTabs({
  settings,
  media,
  presenceVisibility,
  aiSettings,
  aiMigrated,
}: {
  settings: SiteSettings;
  media: SettingsMedia;
  /** The global fallback of the admin's online visibility (Presence card). */
  presenceVisibility: PresenceVisibility;
  aiSettings: PublicAiSettings;
  aiMigrated: boolean;
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

  const [pendingByTab, setPendingByTab] = useState<Record<SettingsTabId, boolean>>({
    general: false,
    seo: false,
    ai: false,
  });

  const handleGeneralPending = useCallback((pending: boolean) => {
    setPendingByTab((prev) => (prev.general === pending ? prev : { ...prev, general: pending }));
  }, []);

  const handleSeoPending = useCallback((pending: boolean) => {
    setPendingByTab((prev) => (prev.seo === pending ? prev : { ...prev, seo: pending }));
  }, []);

  const handleAiPending = useCallback((pending: boolean) => {
    setPendingByTab((prev) => (prev.ai === pending ? prev : { ...prev, ai: pending }));
  }, []);

  function select(key: Key) {
    setTab(key);
    // Keep the tab in the URL without a server round-trip. Next.js syncs useSearchParams with this call
    // only when it is not handed its own history state back (that path is reserved for its internals).
    const url = key === "general" ? "/nemesis/settings" : `/nemesis/settings?tab=${String(key)}`;
    window.history.replaceState(null, "", url);
  }

  const activeTab: SettingsTabId = isSettingsTab(String(tab)) ? (String(tab) as SettingsTabId) : "general";
  const activePending = pendingByTab[activeTab];

  function submitActiveTab() {
    const form = document.getElementById(`settings-form-${activeTab}`);
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
    }
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={select} className="gap-5">
      {/* Sticky top bar: keeps both the section tabs and the top-right Save button pinned while scrolling long forms */}
      <div
        className="sticky top-14 z-20 -mx-3 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-5 md:px-5"
        data-testid="settings-sticky-bar"
      >
        {/* wraps instead of scrolling – an overflow container showed scrollbar arrows next to the tabs on Windows */}
        <TabsList
          aria-label="Settings sections"
          className="h-auto group-data-horizontal/tabs:h-auto max-w-full flex-wrap"
        >
          {SETTINGS_TABS.map((t) => (
            <TabsTrigger key={t.id} id={t.id} className="px-3 py-1.5">
              <t.icon /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            isPending={activePending}
            isDisabled={activePending}
            aria-busy={activePending}
            data-testid="settings-save-button"
            onPress={submitActiveTab}
          >
            {activePending ? <Spinner /> : <SaveIcon />}
            {activePending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* shouldForceMount keeps every form mounted, so unsaved edits survive switching tabs */}
      <TabsContent id="general" shouldForceMount className="data-inert:hidden">
        <div className="space-y-5">
          <GeneralSettingsForm
            settings={settings}
            favicon={media.favicon}
            formId="settings-form-general"
            onPendingChange={handleGeneralPending}
          />
          <PresenceVisibilityCard value={presenceVisibility} />
        </div>
      </TabsContent>
      <TabsContent id="seo" shouldForceMount className="data-inert:hidden">
        <SeoSettingsForm
          settings={settings}
          shareImage={media.share_image}
          formId="settings-form-seo"
          onPendingChange={handleSeoPending}
        />
      </TabsContent>
      <TabsContent id="ai" shouldForceMount className="data-inert:hidden">
        <AiSettingsForm
          initialSettings={aiSettings}
          migrated={aiMigrated}
          formId="settings-form-ai"
          onPendingChange={handleAiPending}
        />
      </TabsContent>
    </Tabs>
  );
}
