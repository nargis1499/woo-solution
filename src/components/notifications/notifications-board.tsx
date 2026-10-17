"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Key } from "react-aria-components";
import { BellOffIcon, CheckCheckIcon, Trash2Icon, XIcon } from "lucide-react";
import { NOTIFICATION_FILTERS, NOTIFICATION_FILTER_LABELS, type AppNotification, type NotificationFilter } from "@/lib/notifications";
import { listHref } from "@/lib/admin/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/components/admin/pagination";
import { PerPageSelect } from "@/components/admin/per-page-select";
import { deleteNotifications, markNotificationsRead } from "./mutations";
import { NotificationRow } from "./notification-row";

/**
 * The notifications page, shared by `/notifications` (customer) and
 * `/nemesis/notifications` (admin).
 *
 * Filters and pagination live in the URL (`?tab=unread&page=2`), so a view is shareable
 * and survives a reload; switching a tab is a normal navigation. Selection, the bulk bar
 * and the optimistic list are client state – mutations go through the provider, which
 * keeps the header badge in step.
 */
export function NotificationsBoard({
  items: serverItems,
  total,
  page,
  perPage,
  filter,
  basePath,
  unread,
  perPageOptions,
}: {
  items: AppNotification[];
  total: number;
  page: number;
  perPage: number;
  filter: NotificationFilter;
  basePath: string;
  /** Unread count as the server rendered it (kept in step after every mutation). */
  unread: number;
  /** Admin pages offer the usual page sizes on the right of the tabs. */
  perPageOptions?: readonly number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [unreadCount, setUnreadCount] = useState(unread);
  const [items, setItems] = useState(serverItems);
  const [seed, setSeed] = useState({ items: serverItems, filter, page });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"read" | "delete" | null>(null);
  // The list a selection belongs to: switching tab or page starts a fresh selection.
  const currentKey = `${filter}:${page}`;
  const [selectionKey, setSelectionKey] = useState(currentKey);

  // A new server render (tab change, page change, router.refresh after a mutation) wins.
  if (seed.items !== serverItems || seed.filter !== filter || seed.page !== page) {
    setSeed({ items: serverItems, filter, page });
    setItems(serverItems);
    setUnreadCount(unread);
  }
  if (selectionKey !== currentKey) {
    setSelectionKey(currentKey);
    setSelected(new Set());
  }

  const selectedIds = useMemo(() => items.filter((n) => selected.has(n.id)).map((n) => n.id), [items, selected]);
  const unreadSelected = useMemo(() => items.filter((n) => selected.has(n.id) && !n.read_at).length, [items, selected]);
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleAll(next: boolean) {
    setSelected(next ? new Set(items.map((n) => n.id)) : new Set());
  }

  function go(nextFilter: NotificationFilter, nextPage = 1) {
    startTransition(() => router.push(listHref(basePath, { tab: nextFilter === "all" ? undefined : nextFilter, page: nextPage })));
  }

  async function markSelected() {
    if (selectedIds.length === 0) return;
    setBusy("read");
    const result = await markNotificationsRead(selectedIds);
    if (result?.unread !== undefined) setUnreadCount(result.unread);
    setItems((prev) => prev.map((n) => (selected.has(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setSelected(new Set());
    setBusy(null);
    router.refresh();
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    setBusy("delete");
    const result = await deleteNotifications(selectedIds);
    if (result?.unread !== undefined) setUnreadCount(result.unread);
    setItems((prev) => prev.filter((n) => !selected.has(n.id)));
    setSelected(new Set());
    setConfirming(false);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="notifications-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          selectedKey={filter}
          onSelectionChange={(key: Key) => key && go(String(key) as NotificationFilter)}
          aria-label="Filter notifications"
          data-testid="notification-filters"
        >
          <TabsList className="h-9">
            {NOTIFICATION_FILTERS.map((value) => (
              <TabsTrigger key={value} id={value} className="px-3" data-testid={`notification-filter-${value}`}>
                {NOTIFICATION_FILTER_LABELS[value]}
                {value === "unread" && unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">{unreadCount}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-3">
          {items.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
              <Checkbox isSelected={allSelected} isIndeterminate={!allSelected && selected.size > 0} onChange={toggleAll} aria-label="Select all on this page" data-testid="notification-select-all" />
              Select all
            </label>
          )}
          {perPageOptions && (
            <PerPageSelect pathname={basePath} params={filter === "all" ? {} : { tab: filter }} page={page} perPage={perPage} options={perPageOptions} />
          )}
        </div>
      </div>

      {pending && <div className="h-0.5 w-full animate-pulse rounded bg-primary/40" aria-hidden />}

      {items.length === 0 ? (
        <Empty className="border border-dashed py-16" data-testid="notifications-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellOffIcon />
            </EmptyMedia>
            <EmptyTitle>{filter === "unread" ? "Nothing unread" : "No notifications yet"}</EmptyTitle>
            <EmptyDescription>
              {filter === "unread" ? "You have read everything in this view." : "Order updates and messages from the store will appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 overflow-visible py-0">
          <ul className="divide-y overflow-hidden rounded-xl" data-testid="notifications-list">
            {items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                selected={selected.has(notification.id)}
                onSelect={(id, next) =>
                  setSelected((prev) => {
                    const copy = new Set(prev);
                    if (next) copy.add(id);
                    else copy.delete(id);
                    return copy;
                  })
                }
                onOpen={(id) => {
                  setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
                  setUnreadCount((prev) => Math.max(0, prev - (items.find((n) => n.id === id && !n.read_at) ? 1 : 0)));
                  void markNotificationsRead([id]);
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      <Pagination pathname={basePath} params={filter === "all" ? {} : { tab: filter }} page={page} perPage={perPage} total={total} itemLabel={total === 1 ? "notification" : "notifications"} />

      {selected.size > 0 && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-3 py-3">
          <div
            role="toolbar"
            aria-label="Selected notifications"
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur duration-200 animate-in fade-in-0 slide-in-from-bottom-2 supports-backdrop-filter:bg-popover/85"
            data-testid="notification-bulk"
          >
            <p className="whitespace-nowrap tabular-nums" aria-live="polite">
              <span className="font-semibold">{selected.size}</span> selected
            </p>
            <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
            <Button variant="ghost" size="sm" className="rounded-full" onPress={() => setSelected(new Set())} isDisabled={busy !== null}>
              <XIcon /> Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onPress={() => void markSelected()}
              isDisabled={busy !== null || unreadSelected === 0}
              isPending={busy === "read"}
              data-testid="notification-bulk-read"
            >
              {busy === "read" ? <Spinner /> : <CheckCheckIcon />}
              Mark as read
            </Button>
            <Button variant="destructive" size="sm" className="rounded-full" onPress={() => setConfirming(true)} isDisabled={busy !== null} data-testid="notification-bulk-delete">
              <Trash2Icon /> Delete
            </Button>
          </div>

          <AlertDialog isOpen={confirming} onOpenChange={(open) => !busy && setConfirming(open)} isDismissable={busy === null}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {selected.size} {selected.size === 1 ? "notification" : "notifications"}?
              </AlertDialogTitle>
              <AlertDialogDescription>The selected notifications are removed for good. The orders and messages they point at are not touched.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel isDisabled={busy !== null}>Cancel</AlertDialogCancel>
              <Button variant="destructive" onPress={() => void deleteSelected()} isPending={busy === "delete"} data-testid="notification-delete-confirm">
                {busy === "delete" ? <Spinner /> : <Trash2Icon />}
                {busy === "delete" ? "Deleting…" : "Delete"}
              </Button>
            </AlertDialogFooter>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
