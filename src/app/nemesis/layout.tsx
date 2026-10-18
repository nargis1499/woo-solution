import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { moneyFromSettings } from "@/lib/money";
import { MoneyProvider } from "@/components/money-provider";
import { AdminHeader } from "@/components/admin/admin-header";
import { NotificationBellGate, NotificationBellSkeleton } from "@/components/notifications/notification-bell-gate";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { AdminSidebar } from "@/components/admin/app-sidebar";
import { FlashToast } from "@/components/admin/flash-toast";
import { ToastPlacement } from "@/components/app-toaster";
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
      {/* the admin is always signed in here – keep their presence fresh for waiting customers */}
      <PresenceHeartbeat />
      {/* dashboard toasts live bottom-right, away from the page header and the sidebar's user menu */}
      <ToastPlacement position="bottom-right" />
      {/* turns ?notice= / ?error= redirects into toasts; useSearchParams() → needs its own Suspense boundary */}
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
    </>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  const [user, cookieStore, settings] = await Promise.all([requireAdmin(), cookies(), getSiteSettingsFresh()]);
  const { store_name } = settings;
  const money = moneyFromSettings(settings);
  // The sidebar component persists its open/collapsed state in this cookie.
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    // Fresh per-request currency for the client components below (the admin price fields read it),
    // overriding the cached value the root layout provides for the storefront.
    <MoneyProvider money={money}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AdminSidebar user={user} storeName={store_name} />
        <SidebarInset>
          {/* the bell is a server island: unread count rendered here, streamed into the header */}
          <AdminHeader bell={
            <Suspense fallback={<NotificationBellSkeleton />}>
              <NotificationBellGate basePath="/nemesis/notifications" />
            </Suspense>
          } />
          <div className="w-full flex-1 px-3 py-4 md:px-5 md:py-5">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </MoneyProvider>
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
