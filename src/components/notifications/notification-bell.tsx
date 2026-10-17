"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, BellIcon, BellOffIcon } from "lucide-react";
import { Dialog, OverlayTriggerStateContext, type OverlayTriggerState } from "react-aria-components";
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
 *
 * The open state is owned here rather than by a `DialogTrigger`/`Popover` pair:
 *
 *   - the bell is a plain button whose press toggles – one press, one change;
 *   - a press anywhere outside the box closes it, Escape closes it, and the
 *     close requests React Aria makes on its own (it treats the focus moving as
 *     "focus left the popover") are ignored.
 *
 * A controlled DialogTrigger used to close on the pointer-down of the second click
 * – the press on the trigger itself – and the trigger's own press then reopened
 * the box, so the bell appeared not to toggle at all. With the state here that
 * cannot happen: only the handlers above change it.
 */
export function NotificationBell({ basePath, className }: { basePath: string; className?: string }) {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Every way the box closes lives here – a press anywhere outside it (but not on the
  // bell, which toggles) and Escape. React Aria also asks to close when focus leaves
  // the popover, which is exactly what pressing the bell does; letting it through is
  // what made the bell close and instantly reopen on the same click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || boxRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true); // capture: the dialog stops Escape from bubbling
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!notifications) return null;

  const { items, unread, live, markAllRead, markRead } = notifications;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  // What the dialog reads for its Escape key / closing behaviour.
  const state: OverlayTriggerState = {
    isOpen: open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen((value) => !value),
    setOpen,
    point: null,
    setPoint: () => {},
  };

  return (
    <OverlayTriggerStateContext.Provider value={state}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className={cn("relative", className)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
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

      <Popover
        triggerRef={triggerRef}
        isOpen={open}
        // `isOpen` is the only source of truth; closes are handled above, never here.
        onOpenChange={(next) => {
          if (next) setOpen(true);
        }}
        placement="bottom end"
        offset={8}
        isNonModal
        className="w-[min(92vw,400px)] gap-0 overflow-hidden p-0"
      >
        <Dialog ref={boxRef} className="flex flex-col outline-none" data-testid="notification-popover">
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
    </OverlayTriggerStateContext.Provider>
  );
}
