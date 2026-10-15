import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { getSiteSettings } from "@/lib/site-settings";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSidebar } from "@/components/admin/app-sidebar";
import { FlashToast } from "@/components/admin/flash-toast";
import { AdminPageSkeleton } from "@/components/admin/ui";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

/**
 * Every /nemesis page renders behind <AdminGate>: signed-out visitors are sent
 * to the login page, signed-in non-admins get the regular 404. Server Actions
 * and data helpers re-check on their own, and RLS enforces it in the database.
 *
 * The dashboard has its own app shell (collapsible sidebar + top bar) instead
 * of the storefront header/footer.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<AdminShellSkeleton />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
      {/* turns ?notice= / ?error= redirects into toasts; useSearchParams() → needs its own Suspense boundary */}
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
    </>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  const [user, cookieStore, { store_name }] = await Promise.all([requireAdmin(), cookies(), getSiteSettings()]);
  // The sidebar component persists its open/collapsed state in this cookie.
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdminSidebar user={user} storeName={store_name} />
      <SidebarInset>
        <AdminHeader />
        <div className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AdminShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full" aria-busy>
      <div className="hidden w-64 shrink-0 space-y-3 border-r p-4 md:block">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-3/4" />
      </div>
      <div className="flex-1 p-4 md:p-6">
        <AdminPageSkeleton />
      </div>
    </div>
  );
}
