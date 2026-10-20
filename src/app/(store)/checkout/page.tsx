import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/site-settings";
import { CheckoutForm } from "@/components/checkout-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Checkout", robots: NOINDEX };

export default function CheckoutPage() {
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Checkout</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" aria-busy />}>
        <CheckoutGate />
      </Suspense>
    </div>
  );
}

async function CheckoutGate() {
  const [user, settings] = await Promise.all([
    getCurrentUser(),
    getSiteSettings(),
  ]);
  if (!user) redirect("/login?next=%2Fcheckout");

  return (
    <CheckoutForm
      user={user}
      storeName={settings.store_name}
      payment={{
        codEnabled: settings.payment_cod_enabled,
        cryptoEnabled: settings.payment_crypto_enabled,
        cryptoProtocols: settings.payment_crypto_protocols.filter((p) => p.enabled),
      }}
    />
  );
}
