"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Key } from "react-aria-components";
import {
  isWoocommerceTab,
  WOOCOMMERCE_TABS,
  type WoocommerceTabId,
} from "@/lib/admin/woocommerce-tabs";
import type { SiteSettings } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShopSettingsForm } from "./settings-forms";
import { PaymentSettings } from "./payment-settings";

export function WoocommerceTabs({
  settings,
  currencyMigrated = true,
}: {
  settings: SiteSettings;
  currencyMigrated?: boolean;
}) {
  const param = useSearchParams().get("tab") ?? undefined;
  const urlTab: WoocommerceTabId = isWoocommerceTab(param) ? param : "general";
  const [tab, setTab] = useState<Key>(urlTab);
  const [seenUrlTab, setSeenUrlTab] = useState<WoocommerceTabId>(urlTab);
  if (seenUrlTab !== urlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }

  function select(key: Key) {
    setTab(key);
    const url =
      key === "general"
        ? "/nemesis/woocommerce"
        : `/nemesis/woocommerce?tab=${String(key)}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={select} className="gap-5">
      <TabsList aria-label="WooCommerce sections" className="h-auto max-w-full flex-wrap">
        {WOOCOMMERCE_TABS.map((t) => (
          <TabsTrigger key={t.id} id={t.id} className="px-3 py-1.5" data-testid={`woo-tab-${t.id}`}>
            <t.icon /> {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent id="general" shouldForceMount className="space-y-5 data-inert:hidden">
        {!currencyMigrated && (
          <Alert variant="destructive">
            <AlertTitle>Database update required</AlertTitle>
            <AlertDescription>
              Run supabase/migrations/20261025000000_currency.sql in the Supabase SQL Editor to enable the currency options.
            </AlertDescription>
          </Alert>
        )}
        <ShopSettingsForm settings={settings} />
      </TabsContent>
      <TabsContent id="payment" shouldForceMount className="space-y-5 data-inert:hidden">
        <PaymentSettings settings={settings} />
      </TabsContent>
    </Tabs>
  );
}
