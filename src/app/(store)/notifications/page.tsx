import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { NOINDEX } from "@/lib/seo";
import { isNotificationFilter } from "@/lib/notifications";
import { listNotifications } from "@/lib/notifications.server";
import { parsePage } from "@/lib/pagination";
import { NotificationsBoard } from "@/components/notifications/notifications-board";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Notifications", robots: NOINDEX };

const BASE_PATH = "/notifications";
const PER_PAGE = 12;

type SearchParams = Promise<{ tab?: string; page?: string }>;

/**
 * Customer notifications page: the same board the dashboard uses, in the shop's chrome.
 * The shell is static; the session-scoped list streams into it behind the boundary.
 */
export default function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-page max-w-3xl py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">Order updates and messages from the store.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" aria-busy />}>
        <NotificationsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NotificationsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(BASE_PATH)}`);

  const sp = await searchParams;
  const filter = isNotificationFilter(sp.tab) ? sp.tab : "all";
  const page = parsePage(sp.page);
  const data = await listNotifications({ filter, page, perPage: PER_PAGE });

  return (
    <>
      <p className="-mt-3 mb-4 text-xs text-muted-foreground" aria-live="polite">
        {data.unread > 0 ? `${data.unread} unread · ` : ""}
        {data.total} {data.total === 1 ? "notification" : "notifications"}
      </p>
      <NotificationsBoard
        items={data.items}
        total={data.total}
        page={data.page}
        perPage={PER_PAGE}
        filter={filter}
        basePath={BASE_PATH}
        unread={data.unread}
      />
    </>
  );
}
