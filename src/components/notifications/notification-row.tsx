"use client";

import Link from "next/link";
import {
  CreditCardIcon,
  MessageSquareIcon,
  PackageCheckIcon,
  PackageXIcon,
  ShoppingBagIcon,
  type LucideIcon,
} from "lucide-react";
import { NOTIFICATION_KIND_LABELS, type AppNotification, type NotificationKind } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RelativeTime } from "./relative-time";

/**
 * One notification, shared by the bell's popover (`compact`) and the notifications page.
 * The whole text block is a link to the page stored in the row, so a customer lands on
 * `/orders/<id>` and an admin on `/nemesis/orders/<id>` without either header knowing
 * the difference.
 */

const ICONS: Record<NotificationKind, { icon: LucideIcon; tile: string }> = {
  new_order: { icon: ShoppingBagIcon, tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  order_status: { icon: PackageCheckIcon, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  order_cancelled: { icon: PackageXIcon, tile: "bg-destructive/10 text-destructive" },
  payment: { icon: CreditCardIcon, tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  order_message: { icon: MessageSquareIcon, tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  const { icon: Icon, tile } = ICONS[kind] ?? ICONS.order_status;
  return (
    <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", tile)} aria-hidden data-testid={`notification-icon-${kind}`}>
      <Icon className="size-4" />
    </span>
  );
}

export function NotificationRow({
  notification,
  compact = false,
  selected,
  onSelect,
  onOpen,
}: {
  notification: AppNotification;
  /** Popover sizing: two lines of body, no kind chip, no checkbox. */
  compact?: boolean;
  selected?: boolean;
  onSelect?: (id: string, next: boolean) => void;
  /** Called on click, before navigating – the caller marks the row read. */
  onOpen?: (id: string) => void;
}) {
  const unread = !notification.read_at;

  return (
    <li
      className={cn("group relative flex items-start gap-3 px-4 py-3.5 transition-colors", unread && "bg-primary/[0.035] hover:bg-primary/[0.06]")}
      data-testid="notification-row"
      data-unread={unread ? "true" : "false"}
      data-kind={notification.kind}
    >
      {onSelect && <Checkbox className="mt-2.5" isSelected={selected === true} onChange={(next) => onSelect(notification.id, next)} aria-label={`Select ${notification.title}`} />}
      <NotificationIcon kind={notification.kind} />

      <div className="min-w-0 flex-1">
        <Link
          href={notification.href}
          onClick={() => onOpen?.(notification.id)}
          className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          data-testid="notification-link"
        >
          <span className="flex items-start gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium text-foreground/90")}>{notification.title}</span>
            {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" data-testid="notification-unread-dot" />}
          </span>
          <span className={cn("mt-0.5 block text-xs leading-relaxed text-muted-foreground", compact ? "line-clamp-2" : "line-clamp-2 sm:line-clamp-1")}>{notification.body}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">{notification.actor_name ?? "Store"}</span>
            <span aria-hidden>·</span>
            <RelativeTime iso={notification.created_at} />
            {!compact && <Badge variant="outline" className="ml-0.5 h-4 px-1.5 text-[10px] font-normal">{NOTIFICATION_KIND_LABELS[notification.kind]}</Badge>}
          </span>
        </Link>
      </div>
    </li>
  );
}
