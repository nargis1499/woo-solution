"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { Key } from "react-aria-components";
import { UI_TABS, isUiTab, type UiTabId } from "@/lib/admin/ui-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tab strip of /nemesis/ui. Mirrors the Settings tabs: the URL (`?tab=…`) is the source of truth,
 * so a tab is shareable and survives a reload. Panels are rendered on the server and passed in.
 */
export function UiTabs({ panels }: { panels: Record<UiTabId, ReactNode> }) {
  const searchParams = useSearchParams();
  const param = searchParams.get("tab") ?? undefined;
  const urlTab: UiTabId = isUiTab(param) ? param : "menu";
  const [tab, setTab] = useState<Key>(urlTab);
  const [seenUrlTab, setSeenUrlTab] = useState<UiTabId>(urlTab);
  if (seenUrlTab !== urlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }

  function select(key: Key) {
    setTab(key);
    // Keep the tab in the URL without a server round-trip; other params (?location=footer) stay as they are.
    const next = new URLSearchParams(searchParams.toString());
    if (key === "menu") next.delete("tab");
    else next.set("tab", String(key));
    const query = next.toString();
    window.history.replaceState(null, "", query ? `/nemesis/ui?${query}` : "/nemesis/ui");
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={select} className="gap-5">
      <TabsList aria-label="UI sections" className="h-auto max-w-full flex-wrap">
        {UI_TABS.map((t) => (
          <TabsTrigger key={t.id} id={t.id} className="px-3 py-1.5">
            <t.icon /> {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {UI_TABS.map((t) => (
        <TabsContent key={t.id} id={t.id}>
          {panels[t.id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
