"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCheckIcon, CheckIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { updateCustomerVisibility } from "@/app/nemesis/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CLOSED_THREAD_MESSAGE, MESSAGE_RECEIPT_LABELS, MAX_ORDER_MESSAGE_LENGTH, customerVisibleReceipt, isOrderChatOpen, lastAdminReplyAt, messageReceipt, orderChatTurn, sortOrderMessages, type MessageReceipt, type OrderChatViewer } from "@/lib/order-chat";
import { PRESENCE_VISIBILITY_LABELS, PRESENCE_VISIBILITIES, isOnline, type Presence, type PresenceVisibility } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type { OrderMessage, OrderStatus } from "@/lib/types";

/**
 * The order inquiry thread — the same component for the customer (/orders/[id]) and the
 * admin (/nemesis/orders/[id]); `viewer` decides whose bubble is which, the rules are
 * identical for both. New messages, read receipts and the other side's presence arrive
 * over SSE (`/api/orders/[id]/chat/stream`), the POST routes are the only writers and
 * they re-check every rule the UI shows.
 *
 * Admin messages sit on the left, customer messages on the right – in both views.
 */

export type ChatCounterpart = {
  name: string;
  avatarUrl: string | null;
  presence: Presence;
};

export function OrderChat({
  orderId,
  status,
  viewer,
  initialMessages,
  counterpart,
  customerName,
  customerId,
  visibility,
}: {
  orderId: string;
  status: OrderStatus;
  viewer: OrderChatViewer;
  initialMessages: OrderMessage[];
  /** Who is on the other side: the store staff (customer view) or the buyer (admin view). */
  counterpart: ChatCounterpart;
  /** Shown as the author of the customer's bubbles (their profile name / the shipping name). */
  customerName?: string | null;
  /** Admin view only: the buyer the privacy switch below the header applies to. */
  customerId?: string | null;
  /** Admin view only: what this buyer currently sees (per-customer override, else the global switch). */
  visibility?: PresenceVisibility;
}) {
  const [messages, setMessages] = useState<OrderMessage[]>(() => sortOrderMessages(initialMessages));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const [presence, setPresence] = useState<Presence>(counterpart.presence);
  const [mode, setMode] = useState<PresenceVisibility>(visibility ?? "online");
  const [, startTransition] = useTransition();
  const list = useRef<HTMLUListElement | null>(null);
  // Only used to build the stream URL once: everything after this timestamp is replayed on connect.
  const since = useRef(initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].created_at : "");
  // Which of the other side's messages this tab already reported: `delivered` is sent once per
  // message, `seen` once per message that was actually on screen. A tab that was hidden only
  // marked delivered, so coming back to it still upgrades the receipt.
  const reportedDelivered = useRef(new Set<string>(initialMessages.filter((m) => m.sender_type !== viewer).map((m) => m.id)));
  const reportedSeen = useRef(new Set<string>());

  const open = isOrderChatOpen(status);
  const latest = messages[messages.length - 1];
  const turn = orderChatTurn(messages, viewer);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_ORDER_MESSAGE_LENGTH;
  const canSend = open && turn.canSend && trimmed.length > 0 && !tooLong && !sending;

  // The customer's side of the receipts: "seen" only while the admin lets them see it
  // (per-customer override, else the global switch) and only once the admin has answered
  // that message. The admin's own view always shows what really happened.
  const adminOnline = isOnline(presence);
  const replyAt = lastAdminReplyAt(messages);
  const receiptFor = (message: OrderMessage): MessageReceipt =>
    viewer === "customer" ? customerVisibleReceipt(message, { adminOnline, lastAdminReplyAt: replyAt }) : messageReceipt(message);

  /** A rejected receipt is reported again by the next effect pass. */
  const retry = (ids: string[]) => {
    for (const id of ids) {
      reportedDelivered.current.delete(id);
      reportedSeen.current.delete(id);
    }
  };

  /** Tell the other side their messages arrived (and, if this tab is visible, that they were read). */
  const report = useCallback(
    (ids: string[], seen: boolean) => {
      if (ids.length === 0) return;
      void fetch(`/api/orders/${orderId}/chat/receipt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: seen ? "seen" : "delivered" }),
        keepalive: true,
      })
        .then((response) => {
          if (response.ok) return;
          retry(ids);
        })
        .catch(() => retry(ids));
    },
    [orderId],
  );

  /** The other side's messages this tab has not marked delivered yet. */
  const undelivered = useCallback(
    (now: OrderMessage[]) => now.filter((m) => m.sender_type !== viewer && !reportedDelivered.current.has(m.id)).map((m) => m.id),
    [viewer],
  );

  /** The other side's messages this tab has not marked seen yet. */
  const unseen = useCallback(
    (now: OrderMessage[]) => now.filter((m) => m.sender_type !== viewer && !reportedSeen.current.has(m.id)).map((m) => m.id),
    [viewer],
  );

  /** Merge new messages and updated delivery/seen timestamps without unnecessary re-renders. */
  const mergeMessages = useCallback((incomingList: OrderMessage[]) => {
    if (incomingList.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      let changed = false;
      for (const item of incomingList) {
        if (!since.current || item.created_at > since.current) {
          since.current = item.created_at;
        }
        const existing = byId.get(item.id);
        if (!existing) {
          byId.set(item.id, item);
          changed = true;
        } else {
          const nextDelivered = item.delivered_at ?? existing.delivered_at;
          const nextSeen = item.seen_at ?? existing.seen_at;
          if (nextDelivered !== existing.delivered_at || nextSeen !== existing.seen_at) {
            byId.set(item.id, { ...existing, delivered_at: nextDelivered, seen_at: nextSeen });
            changed = true;
          }
        }
      }
      return changed ? sortOrderMessages(Array.from(byId.values())) : prev;
    });
  }, []);

  /** Catch-up sync (used on SSE open/reconnect, tab focus, and multi-isolate edge fallback). */
  const syncThread = useCallback(async () => {
    try {
      const response = await fetch(`/api/orders/${orderId}/chat?sync=1`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { messages?: OrderMessage[]; presence?: Presence };
      if (Array.isArray(data.messages)) mergeMessages(data.messages);
      if (data.presence) {
        setPresence((prev) => (JSON.stringify(prev) === JSON.stringify(data.presence) ? prev : data.presence!));
      }
    } catch {
      // keep existing state until next tick
    }
  }, [orderId, mergeMessages]);

  useEffect(() => {
    const source = new EventSource(`/api/orders/${orderId}/chat/stream${since.current ? `?since=${encodeURIComponent(since.current)}` : ""}`);
    source.addEventListener("open", () => {
      setLive(true);
      void syncThread();
    });
    source.addEventListener("message", (event) => {
      let incoming: OrderMessage;
      try {
        incoming = JSON.parse((event as MessageEvent<string>).data) as OrderMessage;
      } catch {
        return;
      }
      mergeMessages([incoming]);
    });
    // ✓ / ✓✓ on our own bubbles: the recipient stamped them (seen implies delivered).
    source.addEventListener("receipt", (event) => {
      let payload: { ids: string[]; status: "delivered" | "seen"; at: string };
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as typeof payload;
      } catch {
        return;
      }
      const ids = new Set(payload.ids);
      setMessages((prev) =>
        prev.map((message) => {
          if (!ids.has(message.id)) return message;
          return payload.status === "seen"
            ? { ...message, delivered_at: message.delivered_at ?? payload.at, seen_at: payload.at }
            : { ...message, delivered_at: message.delivered_at ?? payload.at };
        }),
      );
    });
    // "Online" / "Last seen …" of the other side, pushed whenever it changes.
    source.addEventListener("presence", (event) => {
      try {
        setPresence(JSON.parse((event as MessageEvent<string>).data) as Presence);
      } catch {
        // keep the previous state
      }
    });
    source.addEventListener("error", () => setLive(false));
    const poll = setInterval(() => void syncThread(), 2500);
    const onFocus = () => void syncThread();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      source.close();
    };
  }, [orderId, mergeMessages, syncThread]);

  // Message arrived: mark it delivered, or seen when this tab is actually being looked at.
  useEffect(() => {
    const ids = undelivered(messages);
    if (ids.length === 0) return;
    const seen = document.visibilityState === "visible";
    for (const id of ids) {
      reportedDelivered.current.add(id);
      if (seen) reportedSeen.current.add(id);
    }
    report(ids, seen);
  }, [messages, undelivered, report]);

  // Back at the tab: everything that arrived while it was hidden turns from ✓ into ✓✓.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void syncThread();
      const ids = unseen(messages);
      if (ids.length === 0) return;
      for (const id of ids) reportedSeen.current.add(id);
      report(ids, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [messages, unseen, report, syncThread]);

  // Keep the newest bubble in view: once on mount and again after every message. Only the list
  // scrolls – scrolling the page here would jump the whole order page down the moment it loads.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [messages.length]);

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: OrderMessage; error?: string } | null;
      if (!response.ok || !payload?.message) {
        setError(payload?.error ?? "The message could not be sent. Please try again.");
        return;
      }
      const saved = payload.message;
      mergeMessages([saved]);
      setDraft("");
    } catch {
      setError("The message could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function changeVisibility(next: PresenceVisibility) {
    if (!customerId) return;
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const result = await updateCustomerVisibility(customerId, next);
      if (result.ok) toast.success(`Visibility for this customer set to ${PRESENCE_VISIBILITY_LABELS[next]}.`);
      else {
        setMode(previous);
        toast.error(result.error ?? "The visibility could not be changed.");
      }
    });
  }

  return (
    <Card data-testid="order-chat">
      {/* Header: who is on the other side, their presence, and (admin only) the privacy switch. */}
      <div className="flex flex-wrap items-center gap-3 px-(--card-spacing)">
        <ChatHeader counterpart={counterpart} presence={presence} viewer={viewer} />
        <div className="ml-auto flex items-center gap-2">
          {viewer === "admin" && customerId && (
            <Select
              aria-label="Your visibility to this customer"
              selectedKey={mode}
              onSelectionChange={(key) => key && key !== mode && changeVisibility(String(key) as PresenceVisibility)}
              className="w-36"
              data-testid="order-chat-visibility"
              data-customer={customerId}
            >
              <SelectTrigger size="sm" aria-label="Your visibility to this customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESENCE_VISIBILITIES.map((value) => (
                  <SelectItem key={value} id={value}>
                    {PRESENCE_VISIBILITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span
            className={cn("grid size-6 place-items-center rounded-full", live ? "bg-emerald-500/15" : "bg-muted-foreground/15")}
            data-testid="order-chat-live"
            data-live={live ? "true" : "false"}
            role="status"
            title={live ? "Live updates on" : "Reconnecting…"}
            aria-label={live ? "Live updates on" : "Reconnecting"}
          >
            <span className={cn("animate-chat-live motion-reduce:animate-none size-2 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40 animate-none")} />
          </span>
        </div>
      </div>

      <CardContent className="space-y-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="order-chat-empty">
            No messages yet.
          </p>
        ) : (
          <>
            {/* `overscroll-auto` (the browser default) is deliberate: once the thread is scrolled all
                the way to its newest or oldest message, the wheel / finger keeps going and scrolls the
                page instead of dying inside the box. `overscroll-contain` used to trap it here. */}
            <ul ref={list} className="scrollbar-hidden max-h-64 space-y-3 overflow-y-auto overscroll-auto pr-1" data-testid="order-chat-messages">
              {messages.map((message) => {
                const mine = message.sender_type === viewer;
                return <MessageBubble key={message.id} message={message} mine={mine} status={mine ? receiptFor(message) : null} customerName={customerName} />;
              })}
            </ul>
          </>
        )}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3 border-t">
        {!open ? (
          <p className="text-sm text-muted-foreground" data-testid="order-chat-closed">
            {CLOSED_THREAD_MESSAGE}
          </p>
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <div className="relative min-w-0 flex-1">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={!turn.canSend || sending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  aria-label={viewer === "admin" ? "Reply to the customer" : "Your message"}
                  placeholder="Write a message…"
                  className="min-h-20 pb-7 pr-20"
                  data-testid="order-chat-input"
                />
                <span
                  className={cn("pointer-events-none absolute right-3 bottom-2 text-xs tabular-nums", tooLong ? "font-medium text-destructive" : "text-muted-foreground")}
                  data-testid="order-chat-counter"
                >
                  {trimmed.length} / {MAX_ORDER_MESSAGE_LENGTH}
                </span>
              </div>
              <Button
                type="button"
                onPress={send}
                isDisabled={!canSend}
                className="self-stretch transition-transform duration-150 ease-out motion-reduce:transition-none active:scale-[0.97]"
                data-testid="order-chat-send"
              >
                <SendIcon /> {viewer === "admin" ? "Reply" : "Send"}
              </Button>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="order-chat-error">
                {error}
              </p>
            )}

            {/* Under the text box: whose turn it is on the left, the newest message's time and
                status on the right (✓ sent, ✓✓ delivered, ✓✓ seen). */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <p data-testid="order-chat-note">
                {tooLong ? `Please shorten the message to ${MAX_ORDER_MESSAGE_LENGTH} characters.` : turn.note}
              </p>
              <MessageMeta
                latest={latest}
                mine={latest?.sender_type === viewer}
                status={latest && latest.sender_type === viewer ? receiptFor(latest) : null}
                viewer={viewer}
                customerName={customerName}
                counterpart={counterpart}
              />
            </div>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

/**
 * Avatar + green dot + name, and the "Online" / "Last seen 10:42 AM" line.
 *
 * On the **customer** side the counterpart is the store itself: the badge reads "Admin"
 * and shows the official shield instead of a personal name and photo – who is answering
 * is not the customer's business. The admin's own view shows the buyer as they are.
 */
function ChatHeader({ counterpart, presence, viewer }: { counterpart: ChatCounterpart; presence: Presence; viewer: OrderChatViewer }) {
  const online = isOnline(presence);
  const showTime = !online && Boolean(presence.lastActiveAt);
  const isStore = viewer === "customer";
  const name = isStore ? "Admin" : counterpart.name;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-3" data-testid="order-chat-header" data-online={online ? "true" : "false"}>
      <span className="relative shrink-0">
        {isStore ? (
          <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground" data-testid="order-chat-header-badge" aria-hidden>
            <ShieldCheckIcon className="size-4" />
          </span>
        ) : (
          <Avatar>
            {counterpart.avatarUrl && <AvatarImage src={counterpart.avatarUrl} alt="" />}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        )}
        <span
          className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card", online ? "bg-emerald-500" : "bg-muted-foreground/50")}
          data-testid="order-chat-presence-dot"
          aria-hidden
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" data-testid="order-chat-header-name">
          {name}
        </span>
        <span className="block text-xs text-muted-foreground" data-testid="order-chat-presence">
          {online ? (
            "Online"
          ) : showTime ? (
            <>
              Last seen <LocalTime iso={presence.lastActiveAt as string} data-testid="order-chat-last-seen" />
            </>
          ) : (
            "Offline"
          )}
        </span>
      </span>
    </div>
  );
}

/**
 * A local wall-clock time. `Date` formatting depends on the visitor's timezone and locale,
 * which the server cannot know, so the element opts out of the hydration comparison for its
 * own text (React keeps the server string until the first client render):
 * "10:42 AM" in Dhaka, "05:42 AM" in Lisbon – both correct for their reader.
 */
function LocalTime({ iso, withDate = false, className, "data-testid": testId }: { iso: string; withDate?: boolean; className?: string; "data-testid"?: string }) {
  // Fixed 12-hour "10:42 AM" pattern (the same the ordering receipt uses) so every reader sees
  // a timestamp the admin can talk about on the phone, whichever locale their browser reports.
  const format = (value: Date) =>
    withDate
      ? value.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })
      : value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning className={className} data-testid={testId} title={withDate ? undefined : date.toLocaleString("en-US")}>
      {format(date)}
    </time>
  );
}

function MessageBubble({ message, mine, status, customerName }: { message: OrderMessage; mine: boolean; status: MessageReceipt | null; customerName?: string | null }) {
  const isAdmin = message.sender_type === "admin";
  // The bubble speaks with the store's voice ("Admin" + the shield badge) – who is personally
  // behind it is shown in the thread header, not on every message.
  const name = isAdmin ? "Admin" : message.sender_name || customerName || "Customer";
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <li
      className={cn("animate-chat-in motion-reduce:animate-none flex items-start gap-2", !isAdmin && "flex-row-reverse")}
      data-testid={`order-chat-message-${message.sender_type}`}
      data-message-id={message.id}
    >
      {isAdmin ? (
        // The official store badge instead of a personal picture.
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" data-testid="order-chat-admin-badge" aria-hidden>
          <ShieldCheckIcon className="size-4" />
        </span>
      ) : (
        <Avatar>
          {message.sender_avatar_url && <AvatarImage src={message.sender_avatar_url} alt="" />}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      )}

      {/* The bubble plus, **outside it and just below**, its own time and (for your own
          messages) the ✓ / ✓✓ receipt – aligned to whichever side the bubble is on. */}
      <div className={cn("flex max-w-[85%] min-w-0 flex-col", isAdmin ? "items-start" : "items-end")}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm break-words bg-muted text-muted-foreground",
            isAdmin ? "rounded-tl-sm" : "rounded-tr-sm bg-muted",
          )}
        >
          <p className={cn("text-xs font-bold text-primary")}>{name}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{message.message}</p>
        </div>
        <span
          className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
          data-testid="order-chat-bubble-meta"
          data-status={status ?? "received"}
        >
          <LocalTime iso={message.created_at} />
          {/* ✓ / ✓✓ only on your own messages – the other side's read state is their business. */}
          {mine && status && <Receipt status={status} label={MESSAGE_RECEIPT_LABELS[status]} />}
        </span>
      </div>
    </li>
  );
}

/**
 * The newest message's timestamp and – when it is yours – how far it got, rendered in a
 * line just below the text box instead of inside the bubble.
 */
function MessageMeta({
  latest,
  mine,
  status,
  viewer,
  customerName,
  counterpart,
}: {
  latest: OrderMessage | undefined;
  mine: boolean;
  /** The receipt to paint for `latest` – already masked for the customer (see `receiptFor`). */
  status: MessageReceipt | null;
  viewer: OrderChatViewer;
  customerName?: string | null;
  counterpart: ChatCounterpart;
}) {
  if (!latest) return null;
  const sender = latest.sender_type === "admin" ? (viewer === "customer" ? "Admin" : counterpart.name || "Admin") : latest.sender_name || customerName || "Customer";

  return (
    <span className="flex items-center gap-1.5" data-testid="order-chat-meta" data-status={status ?? (mine ? "sent" : "received")}>
      <span className="sr-only">{mine ? "Your last message" : `Last message from ${sender}`}</span>
      <LocalTime iso={latest.created_at} data-testid="order-chat-meta-time" />
      {mine && status && (
        <>
          <span aria-hidden>·</span>
          <Receipt status={status} label={MESSAGE_RECEIPT_LABELS[status]} prefix="order-chat-meta-receipt" />
          <span data-testid="order-chat-meta-status">{MESSAGE_RECEIPT_LABELS[status]}</span>
        </>
      )}
    </span>
  );
}

/** How far one of *your* messages got: ✓ sent, ✓✓ delivered, ✓✓ (green) seen. */
function Receipt({ status, label, prefix = "order-chat-receipt" }: { status: MessageReceipt; label: string; prefix?: string }) {
  if (status === "seen") {
    return <CheckCheckIcon className="size-3.5 text-emerald-500" data-testid={`${prefix}-seen`} aria-label={label} />;
  }
  if (status === "delivered") {
    return <CheckCheckIcon className="size-3.5 opacity-70" data-testid={`${prefix}-delivered`} aria-label={label} />;
  }
  return <CheckIcon className="size-3.5 opacity-50" data-testid={`${prefix}-sent`} aria-label={label} />;
}
