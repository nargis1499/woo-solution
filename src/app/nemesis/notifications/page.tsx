import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { resolveListParams } from "@/lib/admin/list-params";
import { isNotificationFilter } from "@/lib/notifications";
import { listNotifications } from "@/lib/notifications.server";
import { PER_PAGE_OPTIONS } from "@/lib/admin/pagination";
import { PageHeader } from "@/components/admin/ui";
import { NotificationsBoard } from "@/components/notifications/notifications-board";

export const metadata: Metadata = { title: "Notifications" };

const BASE_PATH = "/nemesis/notifications";

type SearchParams = Promise<{ tab?: string; page?: string; per?: string }>;

/** Admin notifications page: new orders, cancellations, payments and customer inquiries. */
export default async function AdminNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin(BASE_PATH);

  const sp = await searchParams;
  const filter = isNotificationFilter(sp.tab) ? sp.tab : "all";
  const { perPage, requestedPage } = await resolveListParams(sp);
  const data = await listNotifications({ filter, page: requestedPage, perPage });

  return (
    <>
      <PageHeader
        title="Notifications"
        description={data.unread > 0 ? `${data.unread} unread · ${data.total} total` : `${data.total} ${data.total === 1 ? "notification" : "notifications"}`}
      />

      <NotificationsBoard
        items={data.items}
        total={data.total}
        page={data.page}
        perPage={perPage}
        filter={filter}
        basePath={BASE_PATH}
        unread={data.unread}
        perPageOptions={PER_PAGE_OPTIONS}
      />
    </>
  );
}
