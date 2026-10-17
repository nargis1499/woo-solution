import { getAdminStatus } from "@/lib/admin/auth";
import { getNotificationSummary } from "@/lib/notifications.server";
import { NotificationsProvider } from "./notifications-provider";
import { NotificationBell } from "./notification-bell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The header island: user lookup → server-rendered unread count → the live bell.
 *
 * Rendered inside a <Suspense> boundary by both headers, so the shell around it stays
 * static and a signed-out visitor gets nothing (no provider, no bell, no stream). The
 * provider wraps *only the bell*: one EventSource per tab, and the notifications page
 * talks to the provider through `mutations.ts` instead of wrapping another one.
 */
export async function NotificationBellGate({ basePath }: { basePath: string }) {
  const { user } = await getAdminStatus();
  if (!user) return null;

  const initial = await getNotificationSummary();
  return (
    <NotificationsProvider initial={initial}>
      <NotificationBell basePath={basePath} />
    </NotificationsProvider>
  );
}

/** Same footprint as the bell button, so the header does not jump while it streams in. */
export function NotificationBellSkeleton() {
  return <Skeleton className="size-8 rounded-md" aria-hidden />;
}
