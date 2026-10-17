"use client";

import { useState } from "react";
import { ArrowRightIcon, BellIcon, BellOffIcon } from "lucide-react";
import { Dialog, DialogTrigger } from "react-aria-components";
import { Button, LinkButton } from "@/components/ui/button";
import { Popover, PopoverTitle } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNotifications } from "./notifications-provider";
import { NotificationRow } from "./notification-row";

/**
 * The header bell, used unchanged by the storefront and the dashboard.
 *
 * The badge is the live unread count from the tab's single SSE connection; the popover
 * shows the newest notifications, a "Mark all read" shortcut and the link to the
 * dedicated page (`basePath`). A signed-out visitor has no provider above it, so the
 * bell simply renders nothing.
 *
 * It is a **non-modal** popover (`isNonModal`): no dimming underlay, no page-wide
 * `inert` – clicking anywhere outside closes it while the page behind stays usable.
 */
export function NotificationBell({ basePath, className }: { basePath: string; className?: string }) {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  if (!notifications) return null;

  const { items, unread, live, markAllRead, markRead } = notifications;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label={label} data-testid="notification-bell" data-unread={unread}>
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-semibold tabular-nums text-white shadow-sm"
            data-testid="notification-badge"
            aria-hidden
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      <Popover placement="bottom end" offset={8} isNonModal className="w-[min(92vw,400px)] gap-0 overflow-hidden p-0">
        <Dialog className="flex flex-col outline-none" data-testid="notification-popover">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <PopoverTitle className="text-sm font-semibold">Notifications</PopoverTitle>
            <span
              className={cn("size-1.5 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")}
              role="status"
              aria-label={live ? "Live updates on" : "Reconnecting"}
              title={live ? "Live updates on" : "Reconnecting…"}
              data-testid="notification-live"
              data-live={live ? "true" : "false"}
            />
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              onPress={() => void markAllRead()}
              isDisabled={unread === 0}
              data-testid="notification-mark-all"
            >
              Mark all read
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="notification-empty">
              <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                <BellOffIcon className="size-5" />
              </span>
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">Order updates and messages will show up here.</p>
            </div>
          ) : (
            <ul className="scrollbar-hidden max-h-[min(62vh,440px)] divide-y overflow-y-auto overscroll-contain">
              {items.slice(0, 6).map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  compact
                  onOpen={(id) => {
                    void markRead([id]);
                    setOpen(false); // navigating away – do not leave the popover hanging over the next page
                  }}
                />
              ))}
            </ul>
          )}

          <div className="border-t p-2">
            <LinkButton href={basePath} variant="ghost" className="w-full justify-between" onClick={() => setOpen(false)} data-testid="notification-view-all">
              View all notifications
              <ArrowRightIcon className="size-4" />
            </LinkButton>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
