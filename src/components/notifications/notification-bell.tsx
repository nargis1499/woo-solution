"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightIcon, BellIcon, BellOffIcon } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { groupNotifications } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useNotifications } from "./notifications-provider";
import { NotificationRow } from "./notification-row";

/**
 * The header bell, used unchanged by the storefront and the dashboard.
 *
 * The badge is the live unread count from the tab's single SSE connection; the popover
 * shows the newest notifications (with order messages grouped by order), a "Mark all read"
 * shortcut and the link to the dedicated page (`basePath`). A signed-out visitor has no
 * provider above it, so the bell simply renders nothing.
 *
 * Rendered via `createPortal(..., document.body)` with `position: fixed` anchored to
 * `triggerRef.current.getBoundingClientRect()`. Unlike React Aria's `useOverlayPosition`
 * (which imperatively writes document-scroll `top` coordinates onto `element.style`),
 * viewport-fixed coordinates keep the panel pinned directly beneath the sticky header
 * bell at any scroll depth, during chat-box scrolling, and when expanding message threads.
 */
export function NotificationBell({ basePath, className }: { basePath: string; className?: string }) {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 64, right: 16 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const top = Math.max(8, Math.round(rect.bottom + 8));
    const right = Math.max(8, Math.round(window.innerWidth - rect.right));
    setPos((prev) => (prev.top === top && prev.right === right ? prev : { top, right }));
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || boxRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    window.addEventListener("resize", updatePosition, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, updatePosition]);

  const groups = useMemo(
    () => groupNotifications(notifications?.items ?? []).slice(0, 6),
    [notifications?.items],
  );

  if (!notifications) return null;

  const { unread, live, markAllRead, markRead, items } = notifications;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className={cn("relative", className)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => {
          updatePosition();
          setOpen((value) => !value);
        }}
        data-testid="notification-bell"
        data-unread={unread}
      >
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

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={boxRef}
            role="dialog"
            aria-label="Notifications"
            data-slot="popover-content"
            data-testid="notification-popover"
            style={{
              position: "fixed",
              top: `${pos.top}px`,
              right: `${pos.right}px`,
              zIndex: 50,
            }}
            className="flex w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-100"
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
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
                {groups.map((group) => (
                  <NotificationRow
                    key={group.key}
                    notification={group.latest}
                    groupItems={group.items}
                    compact
                    onMarkGroupRead={(ids) => {
                      void markRead(ids);
                    }}
                    onOpen={(ids) => {
                      void markRead(ids);
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
          </div>,
          document.body,
        )}
    </>
  );
}
