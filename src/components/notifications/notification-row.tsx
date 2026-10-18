"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CreditCardIcon,
  MessageSquareIcon,
  PackageCheckIcon,
  PackageXIcon,
  ShoppingBagIcon,
  type LucideIcon,
} from "lucide-react";
import {
  NOTIFICATION_KIND_LABELS,
  type AppNotification,
  type NotificationKind,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RelativeTime } from "./relative-time";

/**
 * One notification or grouped order-message thread, shared by the bell's popover
 * (`compact`) and the notifications page (`NotificationsBoard`).
 *
 * When multiple `order_message` notifications share the same `order_id`, they are
 * aggregated into a single parent card showing the count badge (`5 msgs`), latest
 * message preview (`<Sender> : <Message>`), relative timestamp, and an expandable
 * `CONVERSATION HISTORY` accordion with a `Mark group read` action.
 */

const ICONS: Record<NotificationKind, { icon: LucideIcon; tile: string }> = {
  new_order: {
    icon: ShoppingBagIcon,
    tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  order_status: {
    icon: PackageCheckIcon,
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  order_cancelled: {
    icon: PackageXIcon,
    tile: "bg-destructive/10 text-destructive",
  },
  payment: {
    icon: CreditCardIcon,
    tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  order_message: {
    icon: MessageSquareIcon,
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  const { icon: Icon, tile } = ICONS[kind] ?? ICONS.order_status;
  return (
    <span
      className={cn(
        "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full",
        tile,
      )}
      aria-hidden
      data-testid={`notification-icon-${kind}`}
    >
      <Icon className="size-4" />
    </span>
  );
}

export function NotificationRow({
  notification,
  groupItems,
  defaultExpanded = false,
  compact = false,
  selected,
  onSelect,
  onOpen,
  onMarkGroupRead,
}: {
  notification: AppNotification;
  /** All notifications aggregated in this order group (newest first). */
  groupItems?: AppNotification[];
  /** Whether a grouped message thread starts expanded. */
  defaultExpanded?: boolean;
  /** Popover sizing: tighter lines, no kind chip, no checkbox. */
  compact?: boolean;
  selected?: boolean;
  onSelect?: (ids: string[], next: boolean) => void;
  /** Called on click, before navigating – the caller marks the group/row read. */
  onOpen?: (ids: string[]) => void;
  /** Marks all unread notifications in this group as read without navigating. */
  onMarkGroupRead?: (ids: string[]) => void;
}) {
  const items = useMemo(
    () => (groupItems && groupItems.length > 0 ? groupItems : [notification]),
    [groupItems, notification],
  );
  const allIds = useMemo(() => items.map((n) => n.id), [items]);
  const unreadIds = useMemo(
    () => items.filter((n) => !n.read_at).map((n) => n.id),
    [items],
  );
  const unread = unreadIds.length > 0;
  const isMessage = notification.kind === "order_message";
  const isGroupedMessages = isMessage && items.length > 1;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const actor = notification.actor_name ?? "Store";

  return (
    <li
      className={cn(
        "group relative transition-colors",
        unread && "bg-primary/[0.035] hover:bg-primary/[0.06]",
        expanded && isGroupedMessages && "bg-muted/20",
      )}
      data-testid="notification-row"
      data-unread={unread ? "true" : "false"}
      data-kind={notification.kind}
      data-group-count={items.length}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {onSelect && (
          <Checkbox
            className="mt-2.5"
            isSelected={selected === true}
            onChange={(next) => onSelect(allIds, next)}
            aria-label={`Select ${notification.title}`}
          />
        )}
        <NotificationIcon kind={notification.kind} />

        <div className="min-w-0 flex-1">
          <Link
            href={notification.href}
            onClick={() => onOpen?.(allIds)}
            className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            data-testid="notification-link"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
                    unread
                      ? "font-semibold text-foreground"
                      : "font-medium text-foreground/90",
                  )}
                >
                  {notification.title}
                </span>
                {isGroupedMessages && (
                  <span
                    data-testid="notification-group-badge"
                    className="inline-flex shrink-0 items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold leading-none text-primary ring-1 ring-primary/30"
                  >
                    {items.length} msgs
                  </span>
                )}
              </span>
              {unread && (
                <span
                  className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-primary/15"
                  aria-label="Unread"
                  data-testid="notification-unread-dot"
                >
                  <span className="size-2 rounded-full bg-primary" />
                </span>
              )}
            </span>

            {isMessage ? (
              <span
                className={cn(
                  "mt-0.5 block text-xs leading-relaxed",
                  compact ? "line-clamp-2" : "line-clamp-2 sm:line-clamp-1",
                )}
              >
                <span
                  data-testid="notification-sender-name"
                  className="font-semibold text-primary"
                >
                  {actor}
                </span>{" "}
                <span className="text-muted-foreground">:</span>{" "}
                <span className="text-foreground/90">{notification.body}</span>
              </span>
            ) : (
              <span
                className={cn(
                  "mt-0.5 block text-xs leading-relaxed text-muted-foreground",
                  compact ? "line-clamp-2" : "line-clamp-2 sm:line-clamp-1",
                )}
              >
                {notification.body}
              </span>
            )}
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {!isMessage && (
              <>
                <span
                  data-testid="notification-sender-name"
                  className="font-semibold text-primary"
                >
                  {actor}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            <RelativeTime iso={notification.created_at} />

            {isGroupedMessages && (
              <button
                type="button"
                data-testid="notification-group-toggle"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setExpanded((prev) => !prev);
                }}
                className="inline-flex items-center gap-1 font-medium text-foreground/80 transition-colors hover:text-primary"
              >
                <span>{expanded ? "Collapse thread" : "Expand thread"}</span>
                {expanded ? (
                  <ChevronUpIcon className="size-3.5" />
                ) : (
                  <ChevronDownIcon className="size-3.5" />
                )}
              </button>
            )}

            {!compact && (
              <Badge
                variant="outline"
                className="ml-0.5 h-4 px-1.5 text-[10px] font-normal"
              >
                {NOTIFICATION_KIND_LABELS[notification.kind]}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {isGroupedMessages && expanded && (
        <div
          data-testid="notification-group-history"
          className="relative border-t border-border/70 bg-background/40"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Conversation History
            </span>
            <button
              type="button"
              data-testid="notification-mark-group-read"
              disabled={!unread}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (unreadIds.length > 0) {
                  onMarkGroupRead?.(unreadIds);
                }
              }}
              className="text-xs font-medium text-foreground/85 transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            >
              Mark group read
            </button>
          </div>

          <div
            ref={historyRef}
            className="max-h-56 space-y-2 overflow-y-auto px-4 pb-3"
          >
            {items.map((msg) => {
              const roleLabel = msg.href.startsWith("/nemesis")
                ? "customer"
                : "admin";
              const msgUnread = !msg.read_at;
              return (
                <Link
                  key={msg.id}
                  href={msg.href}
                  data-testid="notification-group-item"
                  onClick={() => onOpen?.(allIds)}
                  className={cn(
                    "block rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-muted/60",
                    msgUnread
                      ? "border-primary/25 bg-primary/[0.03]"
                      : "border-border/70 bg-card/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        data-testid="notification-sender-name"
                        className="truncate font-semibold text-primary"
                      >
                        {msg.actor_name ?? "Store"}
                      </span>
                      <span className="text-muted-foreground">
                        ({roleLabel})
                      </span>
                      <span aria-hidden className="text-muted-foreground">
                        •
                      </span>
                      <RelativeTime iso={msg.created_at} />
                    </div>
                    {msgUnread && (
                      <span
                        aria-label="Unread message"
                        className="size-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-foreground/90 break-words">
                    {msg.body}
                  </p>
                </Link>
              );
            })}
          </div>

          {items.length > 2 && (
            <div className="pointer-events-none flex justify-center pb-2">
              <button
                type="button"
                aria-label="Scroll conversation history"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  historyRef.current?.scrollBy({
                    top: 120,
                    behavior: "smooth",
                  });
                }}
                className="pointer-events-auto grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-primary"
              >
                <ArrowDownIcon className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
