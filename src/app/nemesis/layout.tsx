import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { AdminSidebar } from "@/components/admin/sidebar";
import { FlashToast } from "@/components/admin/flash-toast";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

/**
 * Every /nemesis page renders behind <AdminGate>: signed-out visitors are sent
 * to the login page, signed-in non-admins get the regular 404. Server Actions
 * and data helpers re-check on their own, and RLS enforces it in the database.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container-page py-8">
      <Suspense fallback={<AdminShellSkeleton />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
      {/* turns ?notice= / ?error= redirects into toasts; useSearchParams() → needs its own Suspense boundary */}
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
    </div>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8">
      <AdminSidebar user={user} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AdminShellSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8" aria-busy>
      <div className="card h-14 animate-pulse lg:h-80" />
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-md bg-neutral-200" />
        <div className="card h-72 animate-pulse" />
      </div>
    </div>
  );
}
